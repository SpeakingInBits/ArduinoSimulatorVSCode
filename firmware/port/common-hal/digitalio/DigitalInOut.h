#pragma once

#include "common-hal/microcontroller/Pin.h"
#include "shared-bindings/digitalio/DriveMode.h"
#include "shared-bindings/digitalio/Pull.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *pin;
    bool output;
    bool open_drain;
    bool value;
    digitalio_pull_t pull;
} digitalio_digitalinout_obj_t;
