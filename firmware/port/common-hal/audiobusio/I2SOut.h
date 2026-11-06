#pragma once

#include "common-hal/microcontroller/Pin.h"
#include "peripherals/audio_stream.h"
#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
    bool left_justified;
    const mcu_pin_obj_t *bit_clock;
    const mcu_pin_obj_t *word_select;
    const mcu_pin_obj_t *data;
    uint8_t clock_unit;
    uint8_t serializer;
    bool running;           // Holds the clock unit and serializer until stopped.
    audio_stream_t stream;
} audiobusio_i2sout_obj_t;
