// On-chip resources that the real drivers find by reading enable bits in hardware registers.
// There are no registers here, so these flags stand in for them. The counts are for the
// SAMD21G18A. Everything is released by each object's deinit, which the garbage collector's
// finalisers call at the end of a run. reset_port() only has to clear the DAC: AnalogOut has no
// finaliser, and the real port resets the DAC there too.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#define SERCOM_INST_NUM 6
#define TC_INST_NUM 3
#define TCC_INST_NUM 3
#define NO_FREE_TIMER 0xff

bool sercom_enabled(uint8_t index);
void sercom_set_enabled(uint8_t index, bool enabled);

bool tc_enabled(uint8_t index);
void tc_set_enabled(uint8_t index, bool enabled);
// Same search as find_free_timer() in samd-peripherals: highest free TC first.
uint8_t find_free_timer(void);

bool dac_enabled(void);
void dac_set_enabled(bool enabled);

// The I2S peripheral's enable bits, shared by I2SOut and PDMIn.
bool i2s_clock_unit_enabled(uint8_t unit);
void i2s_set_clock_unit_enabled(uint8_t unit, bool enabled);
bool i2s_serializer_enabled(uint8_t serializer);
void i2s_set_serializer_enabled(uint8_t serializer, bool enabled);

bool eic_get_enable(void);
bool eic_channel_free(uint8_t channel);
void eic_claim_channel(uint8_t channel);
void eic_release_channel(uint8_t channel);
