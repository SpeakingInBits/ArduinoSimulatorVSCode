#pragma once

#include "py/obj.h"

// Field names and slot positions match samd-peripherals, so that validation code can follow
// ports/atmel-samd line for line.
typedef struct {
    uint8_t index;          // 0x3f when unused.
    uint8_t pad;
} pin_sercom_t;

typedef struct {
    uint8_t index;          // 0xf when unused. TC3 is index 0.
    uint8_t is_tc;
    uint8_t wave_output;
} pin_timer_t;

typedef struct {
    mp_obj_base_t base;
    uint8_t number;
    uint8_t has_extint;
    uint8_t extint_channel;
    uint8_t has_touch;
    uint8_t touch_y_line;
    uint8_t adc_input;      // 0xff when the pin has no ADC input.
    pin_timer_t timer[2];
    pin_sercom_t sercom[2];
} mcu_pin_obj_t;

#define NO_PIN 0xff

#include "peripherals/pins.h"

void reset_all_pins(void);
void claim_pin(const mcu_pin_obj_t *pin);
void reset_pin_number(uint8_t pin_number);
void never_reset_pin_number(uint8_t pin_number);
bool pin_number_is_free(uint8_t pin_number);
