#pragma once

#include "common-hal/microcontroller/Pin.h"

typedef struct {
    mp_obj_base_t base;
    uint8_t pin_a;
    uint8_t pin_b;
    uint8_t eic_channel_a;
    uint8_t eic_channel_b;
    int8_t sub_count;       // Quadrature edges since the last whole count.
    int8_t divisor;         // Quadrature edges required per count.
    int host_id;
    int32_t host_count;     // Last count seen from the simulator.
    mp_int_t position;
} rotaryio_incrementalencoder_obj_t;
