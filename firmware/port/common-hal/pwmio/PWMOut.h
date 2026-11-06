#pragma once

#include "common-hal/microcontroller/Pin.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *pin;
    const pin_timer_t *timer;
    bool variable_frequency;
    uint16_t duty_cycle;
    uint32_t compare;       // What the real driver writes to the CC register.
} pwmio_pwmout_obj_t;
