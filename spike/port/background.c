#include "background.h"

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
    }
    int c = sim_serial_peek();
    if (c >= 0 && c == mp_interrupt_char) {
        sim_serial_read();
        mp_sched_keyboard_interrupt();
    }
}

void port_background_tick(void) {
}

void port_start_background_tick(void) {
}

void port_finish_background_tick(void) {
}
