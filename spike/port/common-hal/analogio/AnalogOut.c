#include "shared-bindings/analogio/AnalogOut.h"
#include "shared-bindings/microcontroller/Pin.h"

#include "sim.h"

void common_hal_analogio_analogout_construct(analogio_analogout_obj_t *self,
    const mcu_pin_obj_t *pin) {
    // The SAMD21 has a single DAC output, on PA02 (A0).
    if (pin != &pin_PA02) {
        raise_ValueError_invalid_pin();
    }
    claim_pin(pin);
    self->pin = pin;
    sim_pin_mode(pin->number, SIM_PIN_ANALOG_OUT, 0, 0);
}

bool common_hal_analogio_analogout_deinited(analogio_analogout_obj_t *self) {
    return self->pin == NULL;
}

void common_hal_analogio_analogout_deinit(analogio_analogout_obj_t *self) {
    if (common_hal_analogio_analogout_deinited(self)) {
        return;
    }
    reset_pin_number(self->pin->number);
    self->pin = NULL;
}

// The SAMD21 DAC is 10 bits.
void common_hal_analogio_analogout_set_value(analogio_analogout_obj_t *self, uint16_t value) {
    sim_dac_write(self->pin->number, value >> 6);
}
