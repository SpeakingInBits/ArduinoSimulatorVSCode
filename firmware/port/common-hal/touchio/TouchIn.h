#pragma once

#include "common-hal/microcontroller/Pin.h"

typedef struct {
    mp_obj_base_t base;
    uint8_t pin;
    uint16_t threshold;
} touchio_touchin_obj_t;
