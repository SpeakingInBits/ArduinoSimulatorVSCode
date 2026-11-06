#include "peripherals/resources.h"
#include "py/runtime.h"
#include "shared-bindings/audioio/AudioOut.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared-module/audiocore/__init__.h"

#include "sim.h"

// Follows the SAMD21 parts of ports/atmel-samd/common-hal/audioio/AudioOut.c. A stereo sample is
// played as its first channel only, because this chip has one DAC.

#define MAX_SAMPLE_RATE 350000

// The DAC takes 10 bits. Its real ramp ends on this value, and only the end can be heard here.
static void set_dac(audioio_audioout_obj_t *self, uint16_t value) {
    sim_dac_write(self->left_channel->number, value >> 6);
}

void common_hal_audioio_audioout_construct(audioio_audioout_obj_t *self,
    const mcu_pin_obj_t *left_channel, const mcu_pin_obj_t *right_channel, uint16_t quiescent_value) {
    self->left_channel = NULL;

    // Only support exclusive use of the DAC.
    if (dac_enabled()) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("DAC already in use"));
    }
    if (right_channel != NULL) {
        mp_raise_ValueError(MP_ERROR_TEXT("Right channel unsupported"));
    }
    if (left_channel != &pin_PA02) {
        raise_ValueError_invalid_pin();
    }

    // Use a timer to coordinate when DAC conversions occur.
    uint8_t tc_index = find_free_timer();
    if (tc_index == NO_FREE_TIMER) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("All timers in use"));
    }
    self->tc_index = tc_index;
    tc_set_enabled(tc_index, true);
    dac_set_enabled(true);

    claim_pin(left_channel);
    self->left_channel = left_channel;
    audio_stream_init(&self->stream);
    sim_pin_mode(left_channel->number, SIM_PIN_ANALOG_OUT, 0, 0);

    // Ramp the DAC up.
    self->quiescent_value = quiescent_value;
    set_dac(self, quiescent_value);
}

bool common_hal_audioio_audioout_deinited(audioio_audioout_obj_t *self) {
    return self->left_channel == NULL;
}

void common_hal_audioio_audioout_deinit(audioio_audioout_obj_t *self) {
    if (common_hal_audioio_audioout_deinited(self)) {
        return;
    }
    audio_stream_stop(&self->stream);
    audio_stream_deinit(&self->stream);

    // Ramp the DAC down.
    set_dac(self, 0);
    dac_set_enabled(false);
    tc_set_enabled(self->tc_index, false);
    reset_pin_number(self->left_channel->number);
    self->left_channel = NULL;
}

void common_hal_audioio_audioout_play(audioio_audioout_obj_t *self, mp_obj_t sample, bool loop) {
    if (common_hal_audioio_audioout_get_playing(self)) {
        common_hal_audioio_audioout_stop(self);
    }

    audiosample_base_t *base = audiosample_check(sample);
    mp_arg_validate_int_max(audiosample_get_sample_rate(base), MAX_SAMPLE_RATE, MP_QSTR_sample_rate);

    audio_stream_play(&self->stream, AUDIO_OUTPUT_DAC, self->left_channel->number, sample, loop, true, false);
}

void common_hal_audioio_audioout_pause(audioio_audioout_obj_t *self) {
    audio_stream_pause(&self->stream);
}

void common_hal_audioio_audioout_resume(audioio_audioout_obj_t *self) {
    audio_stream_resume(&self->stream);
}

bool common_hal_audioio_audioout_get_paused(audioio_audioout_obj_t *self) {
    return audio_stream_paused(&self->stream);
}

void common_hal_audioio_audioout_stop(audioio_audioout_obj_t *self) {
    audio_stream_stop(&self->stream);
    // Ramp the DAC to default.
    set_dac(self, self->quiescent_value);
}

bool common_hal_audioio_audioout_get_playing(audioio_audioout_obj_t *self) {
    return audio_stream_playing(&self->stream);
}
