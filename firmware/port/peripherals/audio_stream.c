#include "peripherals/audio_stream.h"

#include <string.h>

#include "py/gc.h"
#include "py/runtime.h"
#include "shared-module/audiocore/__init__.h"
#include "supervisor/background_callback.h"

#include "sim.h"

// How far ahead of the listener to stay. The longest gap between background tasks is the 20ms
// sleep in port_idle_until_interrupt(), so this leaves room for a slow host.
#define TARGET_BUFFERED_MS 120
#define POLL_TICKS 8
#define MAX_BATCH_SAMPLES 2048

static audio_stream_t *active[AUDIO_OUTPUT_COUNT];
static background_callback_t pump_callback;
// Lives outside the Python heap, so that it costs a student's code nothing.
static int16_t batch[MAX_BATCH_SAMPLES];

static void host_start(audio_stream_t *stream, uint32_t sample_rate, uint8_t channels) {
    if (stream->output == AUDIO_OUTPUT_DAC) {
        sim_audio_start(stream->pin, sample_rate, channels);
    } else {
        sim_i2s_start(stream->pin, sample_rate, channels);
    }
}

static void host_write(audio_stream_t *stream, const int16_t *samples, uint32_t count) {
    if (stream->output == AUDIO_OUTPUT_DAC) {
        sim_audio_write(samples, count);
    } else {
        sim_i2s_write(samples, count);
    }
}

static void host_stop(audio_stream_t *stream) {
    if (stream->output == AUDIO_OUTPUT_DAC) {
        sim_audio_stop(stream->pin);
    } else {
        sim_i2s_stop(stream->pin);
    }
}

static void host_pause(audio_stream_t *stream, bool paused) {
    if (stream->output == AUDIO_OUTPUT_DAC) {
        sim_audio_pause(stream->pin, paused);
    } else {
        sim_i2s_pause(stream->pin, paused);
    }
}

static uint32_t host_buffered_ms(audio_stream_t *stream) {
    return stream->output == AUDIO_OUTPUT_DAC ? sim_audio_buffered_ms() : sim_i2s_buffered_ms();
}

static int16_t read_sample(audio_stream_t *stream, const uint8_t *data) {
    if (stream->bytes_per_sample == 1) {
        return stream->samples_signed ? (int8_t)data[0] * 256 : (data[0] - 128) * 256;
    }
    uint16_t raw = data[0] | (data[1] << 8);
    return stream->samples_signed ? (int16_t)raw : (int32_t)raw - 32768;
}

// Reads the next block of the sample. Returns false when there is nothing more to read now.
static bool next_block(audio_stream_t *stream) {
    if (stream->source_done) {
        return false;
    }
    uint8_t *data;
    uint32_t length;
    audioio_get_buffer_result_t result = audiosample_get_buffer(stream->sample,
        stream->single_channel_output, 0, &data, &length);
    if (result == GET_BUFFER_ERROR) {
        stream->source_done = true;
        return false;
    }
    stream->data = data;
    stream->data_length = length;
    if (result == GET_BUFFER_DONE) {
        if (stream->loop && length > 0) {
            audiosample_reset_buffer(stream->sample, stream->single_channel_output, 0);
        } else {
            stream->source_done = true;
        }
    }
    return length > 0;
}

// Fills the batch with up to one target's worth of audio, then sends it.
static void send_batch(audio_stream_t *stream) {
    uint32_t sample_rate = audiosample_get_sample_rate(audiosample_check(stream->sample));
    uint32_t wanted = sample_rate * stream->channel_count * (TARGET_BUFFERED_MS / 2) / 1000;
    if (wanted == 0) {
        wanted = 1;
    } else if (wanted > MAX_BATCH_SAMPLES) {
        wanted = MAX_BATCH_SAMPLES;
    }
    uint32_t stride = stream->bytes_per_sample * stream->spacing;
    uint32_t count = 0;
    while (count < wanted) {
        if (stream->data_length < stream->bytes_per_sample && !next_block(stream)) {
            break;
        }
        batch[count++] = read_sample(stream, stream->data);
        uint32_t step = stride < stream->data_length ? stride : stream->data_length;
        stream->data += step;
        stream->data_length -= step;
    }
    if (count > 0) {
        host_write(stream, batch, count);
    }
}

static bool source_empty(audio_stream_t *stream) {
    return stream->source_done && stream->data_length < stream->bytes_per_sample;
}

static void pump(audio_stream_t *stream) {
    while (!stream->paused && !source_empty(stream) && host_buffered_ms(stream) < TARGET_BUFFERED_MS) {
        send_batch(stream);
    }
    if (source_empty(stream) && !stream->paused && host_buffered_ms(stream) == 0) {
        audio_stream_stop(stream);
    }
}

static void pump_all(void *unused) {
    for (int i = 0; i < AUDIO_OUTPUT_COUNT; i++) {
        if (active[i] != NULL) {
            pump(active[i]);
        }
    }
}

// Counts elapsed ticks, not calls, because a sleeping board only calls this every 20ms or so.
void audio_stream_poll(uint64_t tick) {
    static uint64_t last_pump;
    if (active[AUDIO_OUTPUT_DAC] == NULL && active[AUDIO_OUTPUT_I2S] == NULL) {
        return;
    }
    if (tick - last_pump >= POLL_TICKS) {
        last_pump = tick;
        background_callback_add(&pump_callback, pump_all, NULL);
    }
}

void audio_stream_init(audio_stream_t *stream) {
    memset(stream, 0, sizeof(*stream));
    stream->sample = MP_OBJ_NULL;
}

void audio_stream_deinit(audio_stream_t *stream) {
    for (int i = 0; i < 2; i++) {
        stream->buffer[i] = NULL;
        stream->buffer_length[i] = 0;
    }
}

static void reserve_buffer(audio_stream_t *stream, int index, uint32_t length) {
    stream->buffer[index] = (uint8_t *)m_realloc(stream->buffer[index],
        #if MICROPY_MALLOC_USES_ALLOCATED_SIZE
        stream->buffer_length[index],
        #endif
        length);
    stream->buffer_length[index] = length;
}

void audio_stream_play(audio_stream_t *stream, audio_output_t output, uint8_t pin,
    mp_obj_t sample, bool loop, bool single_channel_output, bool output_signed) {
    audiosample_base_t *base = audiosample_check(sample);
    audiosample_reset_buffer(sample, single_channel_output, 0);

    bool single_buffer;
    bool samples_signed;
    uint32_t max_buffer_length;
    uint8_t spacing;
    audiosample_get_buffer_structure(base, single_channel_output, &single_buffer, &samples_signed,
        &max_buffer_length, &spacing);

    // Same sizes as audio_dma_setup_playback().
    reserve_buffer(stream, 0, output_signed != samples_signed ? max_buffer_length / spacing : max_buffer_length);
    if (!single_buffer) {
        reserve_buffer(stream, 1, output_signed != samples_signed ? max_buffer_length / spacing : max_buffer_length);
    }

    stream->sample = sample;
    stream->output = output;
    stream->pin = pin;
    stream->spacing = spacing;
    stream->bytes_per_sample = audiosample_get_bits_per_sample(base) / 8;
    stream->channel_count = single_channel_output ? 1 : audiosample_get_channel_count(base);
    stream->samples_signed = samples_signed;
    stream->single_channel_output = single_channel_output;
    stream->loop = loop;
    stream->source_done = false;
    stream->paused = false;
    stream->data = NULL;
    stream->data_length = 0;

    host_start(stream, audiosample_get_sample_rate(base), stream->channel_count);
    active[output] = stream;
    pump(stream);
}

void audio_stream_stop(audio_stream_t *stream) {
    if (stream->sample == MP_OBJ_NULL) {
        return;
    }
    stream->sample = MP_OBJ_NULL;
    active[stream->output] = NULL;
    host_stop(stream);
}

void audio_stream_pause(audio_stream_t *stream) {
    if (stream->sample != MP_OBJ_NULL && !stream->paused) {
        stream->paused = true;
        host_pause(stream, true);
    }
}

void audio_stream_resume(audio_stream_t *stream) {
    if (stream->sample != MP_OBJ_NULL && stream->paused) {
        stream->paused = false;
        host_pause(stream, false);
    }
}

bool audio_stream_paused(audio_stream_t *stream) {
    return stream->sample != MP_OBJ_NULL && stream->paused;
}

bool audio_stream_playing(audio_stream_t *stream) {
    if (stream->sample != MP_OBJ_NULL) {
        pump(stream);
    }
    return stream->sample != MP_OBJ_NULL;
}

void audio_stream_reset(void) {
    for (int i = 0; i < AUDIO_OUTPUT_COUNT; i++) {
        if (active[i] != NULL) {
            audio_stream_stop(active[i]);
        }
    }
}
