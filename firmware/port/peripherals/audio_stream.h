// Stands in for ports/atmel-samd/audio_dma.c. Instead of DMA, a background callback reads the
// sample and sends it to the simulator, staying a short way ahead of what is being heard.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "py/obj.h"

typedef enum {
    AUDIO_OUTPUT_DAC,
    AUDIO_OUTPUT_I2S,
    AUDIO_OUTPUT_COUNT,
} audio_output_t;

typedef struct {
    mp_obj_t sample;        // MP_OBJ_NULL when stopped.
    uint8_t *buffer[2];     // The real driver's sample buffers, kept so Python memory matches.
    uint32_t buffer_length[2];
    const uint8_t *data;    // What is left of the block last read from the sample.
    uint32_t data_length;
    audio_output_t output;
    uint8_t pin;
    uint8_t spacing;
    uint8_t bytes_per_sample;
    uint8_t channel_count;
    bool samples_signed;
    bool single_channel_output;
    bool loop;
    bool source_done;
    bool paused;
} audio_stream_t;

void audio_stream_init(audio_stream_t *stream);
void audio_stream_deinit(audio_stream_t *stream);
// output_signed is what the real peripheral wants, which decides how much memory it allocates.
void audio_stream_play(audio_stream_t *stream, audio_output_t output, uint8_t pin,
    mp_obj_t sample, bool loop, bool single_channel_output, bool output_signed);
void audio_stream_stop(audio_stream_t *stream);
void audio_stream_pause(audio_stream_t *stream);
void audio_stream_resume(audio_stream_t *stream);
bool audio_stream_paused(audio_stream_t *stream);
bool audio_stream_playing(audio_stream_t *stream);

// Called from sim_service() on each tick.
void audio_stream_poll(uint64_t tick);
// Stops everything, like audio_dma_reset().
void audio_stream_reset(void);
