#include "peripherals/resources.h"
#include "py/gc.h"
#include "py/runtime.h"
#include "shared-bindings/microcontroller/__init__.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared-bindings/pulseio/PulseIn.h"

#include "sim.h"

// Follows ports/atmel-samd/common-hal/pulseio/PulseIn.c. The simulator measures the pulses, and
// this file keeps the real ring buffer, so maxlen, paused and the error cases behave the same.

// The real driver gives up when more than 15 overflows of its 3MHz 16-bit timer pass after the
// buffer was last empty. Its comment says about 1 second, but the numbers give about 350ms.
#define TIMER_OVERFLOW_US 21845
#define MAX_OVERFLOWS 15

// All PulseIn objects share one timer.
static uint8_t refcount;
static uint8_t pulsein_tc_index = NO_FREE_TIMER;

static void store_pulse(pulseio_pulsein_obj_t *self, uint32_t length) {
    self->capture_us = self->len == 0 ? 0 : self->capture_us + length;
    if (self->capture_us / TIMER_OVERFLOW_US > MAX_OVERFLOWS) {
        self->errored_too_fast = true;
        common_hal_pulseio_pulsein_pause(self);
        return;
    }
    uint16_t i = (self->start + self->len) % self->maxlen;
    self->buffer[i] = length < 0xffff ? length : 0xffff; // Cap duration at 16 bits.
    if (self->len < self->maxlen) {
        self->len++;
    } else {
        self->start = (self->start + 1) % self->maxlen;
    }
}

// There are no interrupts, so pulses are collected whenever Python looks at the object.
static void collect_pulses(pulseio_pulsein_obj_t *self) {
    int count = sim_pulsein_count(self->host_id);
    while (count-- > 0 && !self->errored_too_fast) {
        int length = sim_pulsein_pop(self->host_id);
        if (length < 0) {
            break;
        }
        store_pulse(self, length);
    }
}

void common_hal_pulseio_pulsein_construct(pulseio_pulsein_obj_t *self, const mcu_pin_obj_t *pin,
    uint16_t maxlen, bool idle_state) {
    self->pin = NO_PIN;
    if (!pin->has_extint) {
        raise_ValueError_invalid_pin();
    }
    if (eic_get_enable() && !eic_channel_free(pin->extint_channel)) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("Internal resource(s) in use"));
    }

    self->buffer = (uint16_t *)m_malloc_without_collect(maxlen * sizeof(uint16_t));
    if (self->buffer == NULL) {
        m_malloc_fail(maxlen * sizeof(uint16_t));
    }
    self->channel = pin->extint_channel;
    self->maxlen = maxlen;
    self->idle_state = idle_state;
    self->start = 0;
    self->len = 0;
    self->paused = false;
    self->errored_too_fast = false;
    self->capture_us = 0;

    if (refcount == 0) {
        pulsein_tc_index = find_free_timer();
        if (pulsein_tc_index == NO_FREE_TIMER) {
            mp_raise_RuntimeError(MP_ERROR_TEXT("All timers in use"));
        }
        tc_set_enabled(pulsein_tc_index, true);
    }
    refcount++;

    eic_claim_channel(self->channel);
    self->pin = pin->number;
    claim_pin(pin);
    sim_pin_mode(self->pin, SIM_PIN_INPUT, 0, 0);
    self->host_id = sim_pulsein_open(self->pin, idle_state);
}

bool common_hal_pulseio_pulsein_deinited(pulseio_pulsein_obj_t *self) {
    return self->pin == NO_PIN;
}

void common_hal_pulseio_pulsein_deinit(pulseio_pulsein_obj_t *self) {
    if (common_hal_pulseio_pulsein_deinited(self)) {
        return;
    }
    sim_pulsein_close(self->host_id);
    eic_release_channel(self->channel);
    reset_pin_number(self->pin);
    refcount--;
    if (refcount == 0) {
        tc_set_enabled(pulsein_tc_index, false);
        pulsein_tc_index = NO_FREE_TIMER;
    }
    self->pin = NO_PIN;
}

void common_hal_pulseio_pulsein_pause(pulseio_pulsein_obj_t *self) {
    self->paused = true;
    sim_pulsein_pause(self->host_id);
}

void common_hal_pulseio_pulsein_resume(pulseio_pulsein_obj_t *self, uint16_t trigger_duration) {
    // Pulses from before the pause belong in the buffer ahead of anything captured from now on.
    collect_pulses(self);

    // Make sure we're paused.
    common_hal_pulseio_pulsein_pause(self);

    // Send the trigger pulse.
    if (trigger_duration > 0) {
        sim_pin_mode(self->pin, SIM_PIN_OUTPUT, 0, 0);
        sim_pin_write(self->pin, !self->idle_state);
        common_hal_mcu_delay_us((uint32_t)trigger_duration);
        sim_pin_write(self->pin, self->idle_state);
        sim_pin_mode(self->pin, SIM_PIN_INPUT, 0, 0);
    }

    self->paused = false;
    self->errored_too_fast = false;
    sim_pulsein_resume(self->host_id, trigger_duration);
}

void common_hal_pulseio_pulsein_clear(pulseio_pulsein_obj_t *self) {
    // Drops whatever the simulator is still holding too: those pulses arrived before this call.
    sim_pulsein_clear(self->host_id);
    self->start = 0;
    self->len = 0;
}

uint16_t common_hal_pulseio_pulsein_popleft(pulseio_pulsein_obj_t *self) {
    collect_pulses(self);
    if (self->len == 0) {
        mp_raise_IndexError_varg(MP_ERROR_TEXT("pop from empty %q"), MP_QSTR_PulseIn);
    }
    if (self->errored_too_fast) {
        self->errored_too_fast = 0;
        mp_raise_RuntimeError(MP_ERROR_TEXT("Input taking too long"));
    }
    uint16_t value = self->buffer[self->start];
    self->start = (self->start + 1) % self->maxlen;
    self->len--;
    return value;
}

uint16_t common_hal_pulseio_pulsein_get_maxlen(pulseio_pulsein_obj_t *self) {
    return self->maxlen;
}

uint16_t common_hal_pulseio_pulsein_get_len(pulseio_pulsein_obj_t *self) {
    collect_pulses(self);
    return self->len;
}

bool common_hal_pulseio_pulsein_get_paused(pulseio_pulsein_obj_t *self) {
    collect_pulses(self);
    return self->paused;
}

uint16_t common_hal_pulseio_pulsein_get_item(pulseio_pulsein_obj_t *self, int16_t index) {
    collect_pulses(self);
    if (index < 0) {
        index += self->len;
    }
    if (index < 0 || index >= self->len) {
        mp_raise_IndexError_varg(MP_ERROR_TEXT("%q out of range"), MP_QSTR_index);
    }
    return self->buffer[(self->start + index) % self->maxlen];
}
