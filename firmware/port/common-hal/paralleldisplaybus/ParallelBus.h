#pragma once

#include "common-hal/digitalio/DigitalInOut.h"

typedef struct {
    mp_obj_base_t base;
    digitalio_digitalinout_obj_t command;
    digitalio_digitalinout_obj_t chip_select;
    digitalio_digitalinout_obj_t reset;
    digitalio_digitalinout_obj_t write;
    digitalio_digitalinout_obj_t read;
    uint8_t data0_pin;
} paralleldisplaybus_parallelbus_obj_t;
