#pragma once

#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
    uint8_t number;
    uint8_t adc_input;      // 0xff when the pin has no ADC input.
    uint8_t has_timer;      // Whether a TC or TCC output can reach this pin.
    uint8_t sercom[2][2];   // {sercom index, pad}, 0xff when unused.
} mcu_pin_obj_t;

#include "peripherals/pins.h"

void reset_all_pins(void);
void claim_pin(const mcu_pin_obj_t *pin);
void reset_pin_number(uint8_t pin_number);
