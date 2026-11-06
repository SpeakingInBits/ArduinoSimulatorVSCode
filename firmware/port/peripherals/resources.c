#include "peripherals/resources.h"

// The Metro M0 Express's SPI flash sits on SERCOM5 (PB22, PB23, PB03) and is never released, so
// students can never get that SERCOM. See SPI_FLASH_*_PIN in its mpconfigboard.h.
static uint8_t sercoms = 1 << 5;
static uint8_t tcs;
static uint16_t eic_channels;
static bool dac;
static uint8_t i2s_clock_units;
static uint8_t i2s_serializers;

bool sercom_enabled(uint8_t index) {
    return sercoms & (1 << index);
}

void sercom_set_enabled(uint8_t index, bool enabled) {
    if (enabled) {
        sercoms |= 1 << index;
    } else {
        sercoms &= ~(1 << index);
    }
}

bool tc_enabled(uint8_t index) {
    return tcs & (1 << index);
}

void tc_set_enabled(uint8_t index, bool enabled) {
    if (enabled) {
        tcs |= 1 << index;
    } else {
        tcs &= ~(1 << index);
    }
}

uint8_t find_free_timer(void) {
    for (int index = TC_INST_NUM - 1; index >= 0; index--) {
        if (!tc_enabled(index)) {
            return index;
        }
    }
    return NO_FREE_TIMER;
}

bool dac_enabled(void) {
    return dac;
}

void dac_set_enabled(bool enabled) {
    dac = enabled;
}

bool i2s_clock_unit_enabled(uint8_t unit) {
    return i2s_clock_units & (1 << unit);
}

void i2s_set_clock_unit_enabled(uint8_t unit, bool enabled) {
    if (enabled) {
        i2s_clock_units |= 1 << unit;
    } else {
        i2s_clock_units &= ~(1 << unit);
    }
}

bool i2s_serializer_enabled(uint8_t serializer) {
    return i2s_serializers & (1 << serializer);
}

void i2s_set_serializer_enabled(uint8_t serializer, bool enabled) {
    if (enabled) {
        i2s_serializers |= 1 << serializer;
    } else {
        i2s_serializers &= ~(1 << serializer);
    }
}

// The real EIC turns itself off once no channel is using it.
bool eic_get_enable(void) {
    return eic_channels != 0;
}

bool eic_channel_free(uint8_t channel) {
    return !(eic_channels & (1 << channel));
}

void eic_claim_channel(uint8_t channel) {
    eic_channels |= 1 << channel;
}

void eic_release_channel(uint8_t channel) {
    eic_channels &= ~(1 << channel);
}
