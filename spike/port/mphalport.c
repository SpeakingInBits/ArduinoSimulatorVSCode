#include "py/mphal.h"
#include "mphalport.h"
#include "shared-bindings/microcontroller/__init__.h"

void mp_hal_delay_us(mp_uint_t delay) {
    common_hal_mcu_delay_us(delay);
}

// There are no interrupts here: the simulator is polled from the VM loop.
void mp_hal_disable_all_interrupts(void) {
}

void mp_hal_enable_all_interrupts(void) {
}
