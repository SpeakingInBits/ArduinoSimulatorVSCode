#pragma once

#include "common-hal/microcontroller/Pin.h"

typedef struct {
    mp_obj_base_t base;
    uint8_t channel;
    uint8_t pin;
    uint16_t *buffer;
    uint16_t maxlen;
    bool idle_state;
    bool paused;
    bool errored_too_fast;
    uint16_t start;
    uint16_t len;
    uint32_t capture_us;    // Time since the buffer was last empty.
    int host_id;
} pulseio_pulsein_obj_t;
