#include "shared-bindings/microcontroller/Pin.h"

#include "sim.h"

static uint64_t claimed_pins;
static uint64_t never_reset_pins;

#define PIN_BIT(number) (1ULL << (number))

void reset_all_pins(void) {
    for (int number = 0; number < 64; number++) {
        if ((claimed_pins & PIN_BIT(number)) && !(never_reset_pins & PIN_BIT(number))) {
            sim_pin_mode(number, SIM_PIN_OFF, 0, 0);
        }
    }
    claimed_pins &= never_reset_pins;
}

void reset_pin_number(uint8_t pin_number) {
    claimed_pins &= ~PIN_BIT(pin_number);
    never_reset_pins &= ~PIN_BIT(pin_number);
    sim_pin_mode(pin_number, SIM_PIN_OFF, 0, 0);
}

void claim_pin(const mcu_pin_obj_t *pin) {
    claimed_pins |= PIN_BIT(pin->number);
}

bool common_hal_mcu_pin_is_free(const mcu_pin_obj_t *pin) {
    return !(claimed_pins & PIN_BIT(pin->number));
}

uint8_t common_hal_mcu_pin_number(const mcu_pin_obj_t *pin) {
    return pin->number;
}

void common_hal_never_reset_pin(const mcu_pin_obj_t *pin) {
    never_reset_pins |= PIN_BIT(pin->number);
}

void common_hal_reset_pin(const mcu_pin_obj_t *pin) {
    if (pin != NULL) {
        reset_pin_number(pin->number);
    }
}

void common_hal_mcu_pin_claim(const mcu_pin_obj_t *pin) {
    claim_pin(pin);
}

void common_hal_mcu_pin_claim_number(uint8_t pin_number) {
    claimed_pins |= PIN_BIT(pin_number);
}

void common_hal_mcu_pin_reset_number(uint8_t pin_number) {
    reset_pin_number(pin_number);
}
