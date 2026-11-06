#pragma once

#include "common-hal/microcontroller/Pin.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *scl;
    const mcu_pin_obj_t *sda;
    uint8_t sercom_index;
    bool has_lock;
} busio_i2c_obj_t;
