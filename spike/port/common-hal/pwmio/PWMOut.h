#pragma once

#include "common-hal/microcontroller/Pin.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *pin;
    uint16_t duty;
    uint32_t frequency;
    bool variable_frequency;
} pwmio_pwmout_obj_t;
