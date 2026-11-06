#include "shared-bindings/analogio/AnalogIn.h"
#include "shared-bindings/microcontroller/Pin.h"

#include "sim.h"

void common_hal_analogio_analogin_construct(analogio_analogin_obj_t *self,
    const mcu_pin_obj_t *pin) {
    if (pin->adc_input == 0xff) {
        raise_ValueError_invalid_pin();
    }
    claim_pin(pin);
    self->pin = pin;
    sim_pin_mode(pin->number, SIM_PIN_ANALOG_IN, 0, 0);
}

bool common_hal_analogio_analogin_deinited(analogio_analogin_obj_t *self) {
    return self->pin == NULL;
}

void common_hal_analogio_analogin_deinit(analogio_analogin_obj_t *self) {
    if (common_hal_analogio_analogin_deinited(self)) {
        return;
    }
    reset_pin_number(self->pin->number);
    self->pin = NULL;
}

// The real driver reads 12 bits and scales them to 16 the same way.
uint16_t common_hal_analogio_analogin_get_value(analogio_analogin_obj_t *self) {
    uint16_t value = sim_adc_read(self->pin->number) & 0x0fff;
    return (value << 4) | (value >> 8);
}

float common_hal_analogio_analogin_get_reference_voltage(analogio_analogin_obj_t *self) {
    return 3.3f;
}
