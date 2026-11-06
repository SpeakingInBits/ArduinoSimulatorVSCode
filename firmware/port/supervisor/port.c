#include <stdint.h>
#include <string.h>

#include <emscripten.h>
#include <emscripten/stack.h>

#include "background.h"
#include "peripherals/audio_stream.h"
#include "peripherals/resources.h"
#include "py/gc.h"
#include "py/mphal.h"
#include "py/runtime.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared-bindings/rtc/__init__.h"
#include "shared/runtime/gchelper.h"
#include "shared/runtime/interrupt_char.h"
#include "sim.h"
#include "supervisor/background_callback.h"
#include "supervisor/board.h"
#include "supervisor/port.h"
#include "common-hal/microcontroller/Pin.h"

// Sized for the largest board. Each board profile uses part of it, set at startup.
static uint32_t port_heap[SIM_MAX_PORT_HEAP_BYTES / sizeof(uint32_t)];
#define SPIN_WINDOW_MS 8.0

static uint32_t saved_word;
static double start_ms;
static double wake_at_ms;

bool sim_tick_enabled;

safe_mode_t port_init(void) {
    start_ms = emscripten_get_now();
    // The SPI flash pins from the real board's mpconfigboard.h, which are always in use.
    const mcu_pin_obj_t *flash_pins[] = { &pin_PB22, &pin_PB23, &pin_PB03, &pin_PA13 };
    for (size_t i = 0; i < MP_ARRAY_SIZE(flash_pins); i++) {
        claim_pin(flash_pins[i]);
        common_hal_never_reset_pin(flash_pins[i]);
    }
    return SAFE_MODE_NONE;
}

void reset_port_early(void) {
}

void reset_port(void) {
    audio_stream_reset();
    dac_set_enabled(false);
    reset_all_pins();
    rtc_reset();
}

void reset_to_bootloader(void) {
    sim_reset(1);
    while (true) {
    }
}

void reset_cpu(void) {
    sim_reset(0);
    while (true) {
    }
}

uint32_t *port_stack_get_limit(void) {
    return (uint32_t *)emscripten_stack_get_end();
}

uint32_t *port_stack_get_top(void) {
    return (uint32_t *)emscripten_stack_get_base();
}

uint32_t *port_heap_get_bottom(void) {
    return port_heap;
}

uint32_t *port_heap_get_top(void) {
    return port_heap + sim_port_heap_bytes() / sizeof(uint32_t);
}

void port_set_saved_word(uint32_t value) {
    saved_word = value;
}

uint32_t port_get_saved_word(void) {
    return saved_word;
}

uint64_t port_get_raw_ticks(uint8_t *subticks) {
    double elapsed_ms = emscripten_get_now() - start_ms;
    uint64_t subtick_count = (uint64_t)(elapsed_ms * 32.768);
    if (subticks != NULL) {
        *subticks = subtick_count % 32;
    }
    return subtick_count / 32;
}

void port_enable_tick(void) {
    sim_tick_enabled = true;
}

void port_disable_tick(void) {
    sim_tick_enabled = false;
}

void port_interrupt_after_ticks(uint32_t ticks) {
    wake_at_ms = emscripten_get_now() + ticks * 1000.0 / 1024.0;
}

// Blocks the worker thread, which is what makes time.sleep() cheap. The wait is capped so
// that ticks keep running and a Stop request is noticed quickly.
void port_idle_until_interrupt(void) {
    sim_service();
    if (background_callback_pending() || mp_hal_is_interrupted() || sim_serial_available() > 0) {
        return;
    }
    double remaining_ms = wake_at_ms - emscripten_get_now();
    if (remaining_ms > 0 && remaining_ms <= SPIN_WINDOW_MS) {
        // OS timers can overshoot by several ms, so the end of a sleep spins instead.
        return;
    }
    double wait_ms = remaining_ms - SPIN_WINDOW_MS;
    if (wait_ms < 1) {
        wait_ms = 1;
    } else if (wait_ms > 20) {
        wait_ms = 20;
    }
    sim_wait_ms(wait_ms);
    sim_service();
}

// CircuitPython's gc_collect() calls this in place of the ARM register/stack helper. The
// --spill-pointers link pass guarantees live locals are on this stack during a call.
void gc_helper_collect_regs_and_stack(void) {
    uintptr_t sp = emscripten_stack_get_current();
    uintptr_t top = emscripten_stack_get_base();
    gc_collect_root((void **)sp, (top - sp) / sizeof(uintptr_t));
}
