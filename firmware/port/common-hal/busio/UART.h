#pragma once

#include "common-hal/microcontroller/Pin.h"
#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
    const mcu_pin_obj_t *tx;
    const mcu_pin_obj_t *rx;
    const mcu_pin_obj_t *rts;
    const mcu_pin_obj_t *cts;
    uint8_t sercom_index;
    uint8_t frame_bits;     // Start, data, parity and stop bits of one character.
    uint32_t baudrate;
    uint32_t timeout_ms;
    uint8_t *buffer;        // The receive ring. The newest bytes overwrite the oldest.
    uint32_t buffer_length;
    uint32_t read_index;
    uint32_t write_index;
} busio_uart_obj_t;
