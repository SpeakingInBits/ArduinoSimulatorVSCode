#pragma once

#include "common-hal/microcontroller/Pin.h"
#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *clock_pin;
    const mcu_pin_obj_t *data_pin;
    uint32_t sample_rate;
    uint8_t serializer;
    uint8_t clock_unit;
    uint8_t bit_depth;
} audiobusio_pdmin_obj_t;
