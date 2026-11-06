#include "peripherals/resources.h"
#include "py/runtime.h"
#include "shared-bindings/audiobusio/I2SOut.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared-module/audiocore/__init__.h"

#include "sim.h"

// Follows the SAMD21 parts of ports/atmel-samd/common-hal/audiobusio/I2SOut.c. The G18 package
// has no PB12, so clock unit 1 has no word select pin and only unit 0 can be used for output.

void common_hal_audiobusio_i2sout_construct(audiobusio_i2sout_obj_t *self,
    const mcu_pin_obj_t *bit_clock, const mcu_pin_obj_t *word_select, const mcu_pin_obj_t *data,
    const mcu_pin_obj_t *main_clock, bool left_justified, bool external_clock) {
    self->bit_clock = NULL;
    if (external_clock) {
        mp_raise_NotImplementedError_varg(MP_ERROR_TEXT("%q"), MP_QSTR_external_clock);
    }
    if (main_clock != NULL) {
        mp_raise_NotImplementedError_varg(MP_ERROR_TEXT("%q"), MP_QSTR_main_clock);
    }
    uint8_t serializer = 0xff;
    uint8_t bc_clock_unit = 0xff;
    uint8_t ws_clock_unit = 0xff;
    if (bit_clock == &pin_PA10 || bit_clock == &pin_PA20) { // I2S SCK[0]
        bc_clock_unit = 0;
    } else if (bit_clock == &pin_PB11) { // I2S SCK[1]
        bc_clock_unit = 1;
    }
    if (word_select == &pin_PA11 || word_select == &pin_PA21) { // I2S FS[0]
        ws_clock_unit = 0;
    }
    if (data == &pin_PA07 || data == &pin_PA19) { // I2S SD[0]
        serializer = 0;
    } else if (data == &pin_PA08) { // I2S SD[1]
        serializer = 1;
    }
    if (bc_clock_unit == 0xff) {
        raise_ValueError_invalid_pin_name(MP_QSTR_clock);
    }
    if (ws_clock_unit == 0xff) {
        raise_ValueError_invalid_pin_name(MP_QSTR_word_select);
    }
    if (bc_clock_unit != ws_clock_unit) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("%q and %q must share a clock unit"), MP_QSTR_bit_clock, MP_QSTR_word_select);
    }
    if (serializer == 0xff) {
        raise_ValueError_invalid_pin_name(MP_QSTR_data);
    }
    if (i2s_serializer_enabled(serializer)) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("Serializer in use"));
    }

    self->clock_unit = ws_clock_unit;
    self->serializer = serializer;
    self->bit_clock = bit_clock;
    self->word_select = word_select;
    self->data = data;
    claim_pin(bit_clock);
    claim_pin(word_select);
    claim_pin(data);
    self->left_justified = left_justified;
    self->running = false;
    audio_stream_init(&self->stream);
}

bool common_hal_audiobusio_i2sout_deinited(audiobusio_i2sout_obj_t *self) {
    return self->bit_clock == NULL;
}

void common_hal_audiobusio_i2sout_deinit(audiobusio_i2sout_obj_t *self) {
    if (common_hal_audiobusio_i2sout_deinited(self)) {
        return;
    }
    common_hal_audiobusio_i2sout_stop(self);
    audio_stream_deinit(&self->stream);
    reset_pin_number(self->bit_clock->number);
    self->bit_clock = NULL;
    reset_pin_number(self->word_select->number);
    self->word_select = NULL;
    reset_pin_number(self->data->number);
}

void common_hal_audiobusio_i2sout_play(audiobusio_i2sout_obj_t *self, mp_obj_t sample, bool loop) {
    if (common_hal_audiobusio_i2sout_get_playing(self)) {
        common_hal_audiobusio_i2sout_stop(self);
    }

    audiosample_base_t *base = audiosample_check(sample);

    // The real driver only notices clock unit 0 here, which is the only one output can use.
    if (i2s_clock_unit_enabled(0)) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("Clock unit in use"));
    }
    if (audiosample_get_channel_count(base) > 2) {
        mp_raise_ValueError(MP_ERROR_TEXT("Too many channels in sample"));
    }

    audio_stream_play(&self->stream, AUDIO_OUTPUT_I2S, self->data->number, sample, loop, false, true);
    i2s_set_clock_unit_enabled(self->clock_unit, true);
    i2s_set_serializer_enabled(self->serializer, true);
    self->running = true;
}

void common_hal_audiobusio_i2sout_pause(audiobusio_i2sout_obj_t *self) {
    audio_stream_pause(&self->stream);
}

void common_hal_audiobusio_i2sout_resume(audiobusio_i2sout_obj_t *self) {
    audio_stream_resume(&self->stream);
}

bool common_hal_audiobusio_i2sout_get_paused(audiobusio_i2sout_obj_t *self) {
    return audio_stream_paused(&self->stream);
}

void common_hal_audiobusio_i2sout_stop(audiobusio_i2sout_obj_t *self) {
    audio_stream_stop(&self->stream);
    if (self->running) {
        self->running = false;
        i2s_set_serializer_enabled(self->serializer, false);
        i2s_set_clock_unit_enabled(self->clock_unit, false);
    }
}

bool common_hal_audiobusio_i2sout_get_playing(audiobusio_i2sout_obj_t *self) {
    bool playing = audio_stream_playing(&self->stream);
    if (self->running && !playing) {
        common_hal_audiobusio_i2sout_stop(self);
    }
    return playing;
}
