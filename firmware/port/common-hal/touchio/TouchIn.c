#include "py/runtime.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared-bindings/touchio/TouchIn.h"

#include "sim.h"

// Follows ports/atmel-samd/common-hal/touchio/TouchIn.c, with the PTC replaced by the simulator.
void common_hal_touchio_touchin_construct(touchio_touchin_obj_t *self, const mcu_pin_obj_t *pin,
    const digitalio_pull_t pull) {
    self->pin = NO_PIN;
    if (!pin->has_touch) {
        raise_ValueError_invalid_pin();
    }
    claim_pin(pin);
    self->pin = pin->number;
    sim_pin_mode(self->pin, SIM_PIN_ANALOG_IN, 0, 0);

    // Set a "touched" threshold not too far above the initial value.
    self->threshold = sim_touch_read(self->pin) + 100;
}

bool common_hal_touchio_touchin_deinited(touchio_touchin_obj_t *self) {
    return self->pin == NO_PIN;
}

void common_hal_touchio_touchin_deinit(touchio_touchin_obj_t *self) {
    if (common_hal_touchio_touchin_deinited(self)) {
        return;
    }
    reset_pin_number(self->pin);
    self->pin = NO_PIN;
}

bool common_hal_touchio_touchin_get_value(touchio_touchin_obj_t *self) {
    return sim_touch_read(self->pin) > self->threshold;
}

uint16_t common_hal_touchio_touchin_get_raw_value(touchio_touchin_obj_t *self) {
    return sim_touch_read(self->pin);
}

uint16_t common_hal_touchio_touchin_get_threshold(touchio_touchin_obj_t *self) {
    return self->threshold;
}

void common_hal_touchio_touchin_set_threshold(touchio_touchin_obj_t *self, uint16_t new_threshold) {
    self->threshold = new_threshold;
}
