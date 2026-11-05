#include "py/runtime.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared-bindings/pwmio/PWMOut.h"

#include "sim.h"

pwmout_result_t common_hal_pwmio_pwmout_construct(pwmio_pwmout_obj_t *self,
    const mcu_pin_obj_t *pin, uint16_t duty, uint32_t frequency, bool variable_frequency) {
    if (!pin->has_timer) {
        return PWMOUT_INVALID_PIN;
    }
    if (frequency == 0 || frequency > 6000000) {
        return PWMOUT_INVALID_FREQUENCY;
    }
    claim_pin(pin);
    self->pin = pin;
    self->duty = duty;
    self->frequency = frequency;
    self->variable_frequency = variable_frequency;
    sim_pin_mode(pin->number, SIM_PIN_PWM, 0, 0);
    sim_pwm_set(pin->number, frequency, duty);
    return PWMOUT_OK;
}

void common_hal_pwmio_pwmout_never_reset(pwmio_pwmout_obj_t *self) {
    common_hal_never_reset_pin(self->pin);
}

bool common_hal_pwmio_pwmout_deinited(pwmio_pwmout_obj_t *self) {
    return self->pin == NULL;
}

void common_hal_pwmio_pwmout_deinit(pwmio_pwmout_obj_t *self) {
    if (common_hal_pwmio_pwmout_deinited(self)) {
        return;
    }
    reset_pin_number(self->pin->number);
    self->pin = NULL;
}

void common_hal_pwmio_pwmout_set_duty_cycle(pwmio_pwmout_obj_t *self, uint16_t duty) {
    self->duty = duty;
    sim_pwm_set(self->pin->number, self->frequency, duty);
}

uint16_t common_hal_pwmio_pwmout_get_duty_cycle(pwmio_pwmout_obj_t *self) {
    return self->duty;
}

void common_hal_pwmio_pwmout_set_frequency(pwmio_pwmout_obj_t *self, uint32_t frequency) {
    if (frequency == 0 || frequency > 6000000) {
        mp_arg_error_invalid(MP_QSTR_frequency);
    }
    self->frequency = frequency;
    sim_pwm_set(self->pin->number, frequency, self->duty);
}

uint32_t common_hal_pwmio_pwmout_get_frequency(pwmio_pwmout_obj_t *self) {
    return self->frequency;
}

bool common_hal_pwmio_pwmout_get_variable_frequency(pwmio_pwmout_obj_t *self) {
    return self->variable_frequency;
}

const mcu_pin_obj_t *common_hal_pwmio_pwmout_get_pin(pwmio_pwmout_obj_t *self) {
    return self->pin;
}
