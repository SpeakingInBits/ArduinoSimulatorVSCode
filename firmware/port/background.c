#include "background.h"

#include <emscripten.h>

#include "peripherals/audio_stream.h"

#include "py/mphal.h"
#include "py/runtime.h"
#include "shared/runtime/interrupt_char.h"
#include "supervisor/port.h"
#include "supervisor/shared/tick.h"
#include "sim.h"

extern bool sim_tick_enabled;

// Runs on every VM loop iteration, so it stands in for the hardware tick interrupt.
void port_background_task(void) {
    static uint32_t calls;
    if (++calls < 256) {
        return;
    }
    calls = 0;
    sim_service();
}

void sim_service(void) {
    static uint64_t last_tick;
    uint64_t tick = port_get_raw_ticks(NULL);
    if (tick != last_tick) {
        last_tick = tick;
        if (sim_tick_enabled) {
            supervisor_tick();
        }
        audio_stream_poll(tick);
    }
    int c = sim_serial_peek();
    if (c >= 0 && c == mp_interrupt_char) {
        sim_serial_read();
        mp_sched_keyboard_interrupt();
    }
}

void sim_wait_us(uint64_t us) {
    double end_ms = emscripten_get_now() + us / 1000.0;
    while (!mp_hal_is_interrupted()) {
        double remaining_ms = end_ms - emscripten_get_now();
        if (remaining_ms <= 0) {
            break;
        }
        RUN_BACKGROUND_TASKS;
        sim_service();
        // OS timers can overshoot by several ms, so only the start of a long wait sleeps.
        if (remaining_ms > 8) {
            sim_wait_ms(1);
        }
    }
}

void port_background_tick(void) {
}

void port_start_background_tick(void) {
}

void port_finish_background_tick(void) {
}
