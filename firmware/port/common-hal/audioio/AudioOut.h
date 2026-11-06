#pragma once

#include "common-hal/microcontroller/Pin.h"
#include "peripherals/audio_stream.h"
#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *left_channel;
    audio_stream_t stream;
    uint8_t tc_index;
    uint16_t quiescent_value;
} audioio_audioout_obj_t;
