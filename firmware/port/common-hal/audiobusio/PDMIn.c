#include <math.h>

#include "background.h"
#include "peripherals/resources.h"
#include "py/mphal.h"
#include "py/runtime.h"
#include "shared-bindings/audiobusio/PDMIn.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared/runtime/interrupt_char.h"

#include "sim.h"

// Validation follows the SAMD21 parts of ports/atmel-samd/common-hal/audiobusio/PDMIn.c. The real
// driver filters the microphone's bit stream, and here the simulator supplies the filtered result.

#define OVERSAMPLING 64
#define MIN_MIC_CLOCK 1000000
#define CHUNK_SAMPLES 256

void common_hal_audiobusio_pdmin_construct(audiobusio_pdmin_obj_t *self,
    const mcu_pin_obj_t *clock_pin, const mcu_pin_obj_t *data_pin, uint32_t sample_rate,
    uint8_t bit_depth, bool mono, uint8_t oversample) {
    self->clock_pin = NULL;

    if (clock_pin == &pin_PA10 || clock_pin == &pin_PA20) {
        self->clock_unit = 0;
    } else if (clock_pin == &pin_PB11) {
        self->clock_unit = 1;
    } else {
        raise_ValueError_invalid_pin_name(MP_QSTR_clock);
    }

    if (data_pin == &pin_PA07 || data_pin == &pin_PA19) {
        self->serializer = 0;
    } else if (data_pin == &pin_PA08) {
        self->serializer = 1;
    } else {
        raise_ValueError_invalid_pin_name(MP_QSTR_data);
    }

    if (!(bit_depth == 16 || bit_depth == 8) || !mono || oversample != OVERSAMPLING) {
        mp_raise_NotImplementedError_varg(MP_ERROR_TEXT("Only 8 or 16 bit mono with %dx oversampling supported."), OVERSAMPLING);
    }

    if (i2s_serializer_enabled(self->serializer)) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("Serializer in use"));
    }

    uint32_t clock_divisor = (uint32_t)roundf(48000000.0f / sample_rate / oversample);
    float mic_clock_freq = 48000000.0f / clock_divisor;
    self->sample_rate = mic_clock_freq / oversample;
    if (mic_clock_freq < MIN_MIC_CLOCK || clock_divisor == 0) {
        mp_raise_ValueError(MP_ERROR_TEXT("sampling rate out of range"));
    }

    // The real driver runs the clock all the time to avoid the microphone's startup delay.
    i2s_set_clock_unit_enabled(self->clock_unit, true);

    self->clock_pin = clock_pin;
    self->data_pin = data_pin;
    claim_pin(clock_pin);
    claim_pin(data_pin);
    self->bit_depth = bit_depth;
}

bool common_hal_audiobusio_pdmin_deinited(audiobusio_pdmin_obj_t *self) {
    return self->clock_pin == NULL;
}

void common_hal_audiobusio_pdmin_deinit(audiobusio_pdmin_obj_t *self) {
    if (common_hal_audiobusio_pdmin_deinited(self)) {
        return;
    }
    i2s_set_clock_unit_enabled(self->clock_unit, false);
    reset_pin_number(self->clock_pin->number);
    reset_pin_number(self->data_pin->number);
    self->clock_pin = NULL;
    self->data_pin = NULL;
}

uint8_t common_hal_audiobusio_pdmin_get_bit_depth(audiobusio_pdmin_obj_t *self) {
    return self->bit_depth;
}

uint32_t common_hal_audiobusio_pdmin_get_sample_rate(audiobusio_pdmin_obj_t *self) {
    return self->sample_rate;
}

// Blocks for as long as the recording takes, as the real one does. Python sees unsigned values
// centred on the middle of the range, because that is what the real filter produces.
uint32_t common_hal_audiobusio_pdmin_record_to_buffer(audiobusio_pdmin_obj_t *self,
    uint16_t *output_buffer, uint32_t output_buffer_length) {
    int16_t chunk[CHUNK_SAMPLES];
    uint32_t values_output = 0;
    i2s_set_serializer_enabled(self->serializer, true);
    while (values_output < output_buffer_length && !mp_hal_is_interrupted()) {
        uint32_t count = output_buffer_length - values_output;
        if (count > CHUNK_SAMPLES) {
            count = CHUNK_SAMPLES;
        }
        sim_pdm_read(chunk, count, self->sample_rate);
        for (uint32_t i = 0; i < count; i++) {
            uint16_t value = (uint16_t)(chunk[i] + 32768);
            if (self->bit_depth == 8) {
                // Truncate to 8 bits.
                ((uint8_t *)output_buffer)[values_output] = value >> 8;
            } else {
                output_buffer[values_output] = value;
            }
            values_output++;
        }
        sim_wait_us((uint64_t)count * 1000000 / self->sample_rate);
    }
    i2s_set_serializer_enabled(self->serializer, false);
    return values_output;
}
