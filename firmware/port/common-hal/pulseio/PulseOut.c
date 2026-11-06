#include <emscripten.h>

#include "background.h"
#include "peripherals/resources.h"
#include "py/runtime.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared-bindings/pulseio/PulseOut.h"
#include "shared-bindings/pwmio/PWMOut.h"

#include "sim.h"

// Follows ports/atmel-samd/common-hal/pulseio/PulseOut.c: a PWM carrier gated by a spare timer.

// All PulseOut objects share one timer.
static uint8_t refcount;
static uint8_t pulseout_tc_index = NO_FREE_TIMER;

void common_hal_pulseio_pulseout_construct(pulseio_pulseout_obj_t *self, const mcu_pin_obj_t *pin,
    uint32_t frequency, uint16_t duty_cycle) {
    self->pwmout.pin = NULL;
    pwmout_result_t result = common_hal_pwmio_pwmout_construct(&self->pwmout, pin, duty_cycle,
        frequency, false);

    // This will raise an exception and not return if needed.
    common_hal_pwmio_pwmout_raise_error(result);

    if (refcount == 0) {
        pulseout_tc_index = find_free_timer();
        if (pulseout_tc_index == NO_FREE_TIMER) {
            common_hal_pwmio_pwmout_deinit(&self->pwmout);
            mp_raise_RuntimeError(MP_ERROR_TEXT("All timers in use"));
        }
        tc_set_enabled(pulseout_tc_index, true);
    }
    refcount++;

    self->pin = pin->number;
    self->frequency = common_hal_pwmio_pwmout_get_frequency(&self->pwmout);
    self->duty_cycle = duty_cycle;

    // The real driver disconnects the carrier and holds the pin low between sends.
    sim_pwm_set(self->pin, self->frequency, 0);
    sim_pin_mode(self->pin, SIM_PIN_OUTPUT, 0, 0);
    sim_pin_write(self->pin, 0);
}

bool common_hal_pulseio_pulseout_deinited(pulseio_pulseout_obj_t *self) {
    return common_hal_pwmio_pwmout_deinited(&self->pwmout);
}

void common_hal_pulseio_pulseout_deinit(pulseio_pulseout_obj_t *self) {
    if (common_hal_pulseio_pulseout_deinited(self)) {
        return;
    }
    refcount--;
    if (refcount == 0) {
        tc_set_enabled(pulseout_tc_index, false);
        pulseout_tc_index = NO_FREE_TIMER;
    }
    self->pin = NO_PIN;
    common_hal_pwmio_pwmout_deinit(&self->pwmout);
}

void common_hal_pulseio_pulseout_send(pulseio_pulseout_obj_t *self, uint16_t *pulses, uint16_t length) {
    uint64_t total_us = 0;
    for (uint16_t i = 0; i < length; i++) {
        total_us += pulses[i];
    }
    // Measured from before the call, so a host that blocks for the pulses adds no extra wait.
    double started_ms = emscripten_get_now();
    sim_pulseout_send(self->pin, self->frequency, self->duty_cycle, pulses, length);
    double spent_us = (emscripten_get_now() - started_ms) * 1000.0;
    if (spent_us < total_us) {
        sim_wait_us(total_us - (uint64_t)spent_us);
    }
}
