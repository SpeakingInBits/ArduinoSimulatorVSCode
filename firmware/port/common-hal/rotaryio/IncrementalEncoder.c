#include "peripherals/resources.h"
#include "py/runtime.h"
#include "shared-bindings/digitalio/Pull.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared-bindings/rotaryio/IncrementalEncoder.h"

#include "sim.h"

// Validation follows ports/atmel-samd/common-hal/rotaryio/IncrementalEncoder.c. The simulator
// decodes the quadrature signal, and sync() applies each edge the way the soft encoder in
// shared-module/rotaryio does, so divisors behave the same. A reversal that happens entirely
// between two reads of position collapses into the net movement.
static void sync(rotaryio_incrementalencoder_obj_t *self) {
    int32_t count = sim_encoder_read(self->host_id);
    int32_t edges = count - self->host_count;
    self->host_count = count;
    int8_t step = edges < 0 ? -1 : 1;
    for (; edges != 0; edges -= step) {
        self->sub_count += step;
        if (self->sub_count >= self->divisor) {
            self->position += 1;
            self->sub_count = 0;
        } else if (self->sub_count <= -self->divisor) {
            self->position -= 1;
            self->sub_count = 0;
        }
    }
}

void common_hal_rotaryio_incrementalencoder_construct(rotaryio_incrementalencoder_obj_t *self,
    const mcu_pin_obj_t *pin_a, const mcu_pin_obj_t *pin_b) {
    // Ensure object starts in its deinit state.
    common_hal_rotaryio_incrementalencoder_mark_deinit(self);

    if (!pin_a->has_extint) {
        raise_ValueError_invalid_pin_name(MP_QSTR_pin_a);
    }
    if (!pin_b->has_extint) {
        raise_ValueError_invalid_pin_name(MP_QSTR_pin_b);
    }

    if (eic_get_enable() &&
        (!eic_channel_free(pin_a->extint_channel) || !eic_channel_free(pin_b->extint_channel))) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("Internal resource(s) in use"));
    }

    self->eic_channel_a = pin_a->extint_channel;
    self->eic_channel_b = pin_b->extint_channel;
    eic_claim_channel(self->eic_channel_a);
    eic_claim_channel(self->eic_channel_b);
    self->pin_a = pin_a->number;
    self->pin_b = pin_b->number;
    claim_pin(pin_a);
    claim_pin(pin_b);
    sim_pin_mode(self->pin_a, SIM_PIN_INPUT, PULL_UP, 0);
    sim_pin_mode(self->pin_b, SIM_PIN_INPUT, PULL_UP, 0);

    self->position = 0;
    self->sub_count = 0;
    self->host_id = sim_encoder_open(self->pin_a, self->pin_b);
    self->host_count = sim_encoder_read(self->host_id);
}

bool common_hal_rotaryio_incrementalencoder_deinited(rotaryio_incrementalencoder_obj_t *self) {
    return self->pin_a == NO_PIN;
}

void common_hal_rotaryio_incrementalencoder_mark_deinit(rotaryio_incrementalencoder_obj_t *self) {
    self->pin_a = NO_PIN;
}

void common_hal_rotaryio_incrementalencoder_deinit(rotaryio_incrementalencoder_obj_t *self) {
    if (common_hal_rotaryio_incrementalencoder_deinited(self)) {
        return;
    }
    sim_encoder_close(self->host_id);
    eic_release_channel(self->eic_channel_a);
    eic_release_channel(self->eic_channel_b);
    reset_pin_number(self->pin_a);
    reset_pin_number(self->pin_b);
    common_hal_rotaryio_incrementalencoder_mark_deinit(self);
}

mp_int_t common_hal_rotaryio_incrementalencoder_get_position(rotaryio_incrementalencoder_obj_t *self) {
    sync(self);
    return self->position;
}

void common_hal_rotaryio_incrementalencoder_set_position(rotaryio_incrementalencoder_obj_t *self,
    mp_int_t new_position) {
    sync(self);
    self->position = new_position;
    self->host_count = new_position * self->divisor;
    sim_encoder_write(self->host_id, self->host_count);
}

mp_int_t common_hal_rotaryio_incrementalencoder_get_divisor(rotaryio_incrementalencoder_obj_t *self) {
    return self->divisor;
}

void common_hal_rotaryio_incrementalencoder_set_divisor(rotaryio_incrementalencoder_obj_t *self,
    mp_int_t new_divisor) {
    sync(self);
    self->divisor = new_divisor;
}
