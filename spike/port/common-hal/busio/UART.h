#pragma once

#include "common-hal/microcontroller/Pin.h"
#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *tx;
    const mcu_pin_obj_t *rx;
    bool active;
    uint32_t baudrate;
    mp_float_t timeout;
} busio_uart_obj_t;
