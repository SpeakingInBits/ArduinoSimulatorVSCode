#pragma once

#include "common-hal/microcontroller/Pin.h"
#include "common-hal/pwmio/PWMOut.h"

typedef struct {
    mp_obj_base_t base;
    pwmio_pwmout_obj_t pwmout;
    uint8_t pin;
    uint32_t frequency;
    uint16_t duty_cycle;
} pulseio_pulseout_obj_t;
