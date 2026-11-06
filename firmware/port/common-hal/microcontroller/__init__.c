#include <emscripten.h>

#include "py/mphal.h"
#include "py/obj.h"
#include "py/runtime.h"
#include "common-hal/microcontroller/Pin.h"
#include "common-hal/microcontroller/Processor.h"
#include "shared-bindings/microcontroller/__init__.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared-bindings/microcontroller/Processor.h"
#include "shared-bindings/nvm/ByteArray.h"
#include "sim.h"
#include "supervisor/port.h"
#include "supervisor/shared/safe_mode.h"

void common_hal_mcu_delay_us(uint32_t delay) {
    // JavaScript can stall for hundreds of microseconds at any moment, so a simulated part cannot
    // time bit-banged signals with a clock. This tells it how long the board meant to wait.
    sim_delay_us(delay);
    double end = emscripten_get_now() + delay / 1000.0;
    while (emscripten_get_now() < end) {
    }
}

void common_hal_mcu_disable_interrupts(void) {
}

void common_hal_mcu_enable_interrupts(void) {
}

void common_hal_mcu_on_next_reset(mcu_runmode_t runmode) {
    if (runmode == RUNMODE_SAFE_MODE) {
        safe_mode_on_next_reset(SAFE_MODE_PROGRAMMATIC);
    }
}

void common_hal_mcu_reset(void) {
    reset_cpu();
}

const mcu_processor_obj_t common_hal_mcu_processor_obj = {
    .base = { .type = &mcu_processor_type },
};

// The singleton nvm.ByteArray object.
const nvm_bytearray_obj_t common_hal_mcu_nvm_obj = {
    .base = { .type = &nvm_bytearray_type },
    .len = CIRCUITPY_INTERNAL_NVM_SIZE,
};

#define PIN_ENTRY(name) { MP_ROM_QSTR(MP_QSTR_##name), MP_ROM_PTR(&pin_##name) },
static const mp_rom_map_elem_t mcu_pin_global_dict_table[] = {
    SIM_FOR_EACH_PIN(PIN_ENTRY)
};
MP_DEFINE_CONST_DICT(mcu_pin_globals, mcu_pin_global_dict_table);
