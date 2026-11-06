#include "peripherals/resources.h"
#include "py/runtime.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared-bindings/microcontroller/Processor.h"
#include "shared-bindings/pwmio/PWMOut.h"

#include "sim.h"

// Timer allocation and arithmetic follow ports/atmel-samd/common-hal/pwmio/PWMOut.c, so that the
// same pins conflict, the same frequencies are rounded, and duty cycles read back the same.

#define NUM_TIMERS_PER_PIN 2

static const uint16_t prescaler[8] = {1, 2, 4, 8, 16, 64, 256, 1024};
static const uint8_t tcc_sizes[TCC_INST_NUM] = {24, 24, 16};
static const uint8_t tcc_cc_num[TCC_INST_NUM] = {4, 2, 2};

static uint32_t tcc_periods[TCC_INST_NUM];
static uint32_t tc_periods[TC_INST_NUM];
static uint8_t tcc_divisors[TCC_INST_NUM];
static uint8_t tc_divisors[TC_INST_NUM];

static uint32_t target_tcc_frequencies[TCC_INST_NUM];
static uint8_t tcc_refcount[TCC_INST_NUM];

// This bitmask keeps track of which channels of a TCC are currently claimed.
static uint8_t tcc_channels[TCC_INST_NUM];

void common_hal_pwmio_pwmout_never_reset(pwmio_pwmout_obj_t *self) {
    common_hal_never_reset_pin(self->pin);
}

static uint8_t tcc_channel(const pin_timer_t *t) {
    return t->wave_output % tcc_cc_num[t->index];
}

static bool channel_ok(const pin_timer_t *t) {
    uint8_t channel_bit = 1 << tcc_channel(t);
    return (!t->is_tc && ((tcc_channels[t->index] & channel_bit) == 0)) || t->is_tc;
}

static bool tcc_enabled(uint8_t index) {
    return tcc_refcount[index] > 0;
}

// First determine the divisor that gets us the highest resolution.
static void find_divisor(uint32_t frequency, uint8_t resolution, uint32_t *top, uint8_t *divisor) {
    uint32_t system_clock = common_hal_mcu_processor_get_frequency();
    for (*divisor = 0; *divisor < 8; (*divisor)++) {
        *top = (system_clock / prescaler[*divisor] / frequency) - 1;
        if (*top < (1u << resolution)) {
            break;
        }
    }
}

static void update_host(pwmio_pwmout_obj_t *self) {
    sim_pwm_set(self->pin->number, common_hal_pwmio_pwmout_get_frequency(self), self->duty_cycle);
}

pwmout_result_t common_hal_pwmio_pwmout_construct(pwmio_pwmout_obj_t *self,
    const mcu_pin_obj_t *pin, uint16_t duty, uint32_t frequency, bool variable_frequency) {
    self->pin = NULL;
    self->variable_frequency = variable_frequency;
    self->duty_cycle = duty;

    if (pin->timer[0].index >= TC_INST_NUM && pin->timer[1].index >= TCC_INST_NUM) {
        return PWMOUT_INVALID_PIN;
    }

    uint32_t system_clock = common_hal_mcu_processor_get_frequency();
    if (frequency == 0 || frequency > system_clock / 2) {
        return PWMOUT_INVALID_FREQUENCY;
    }

    // First see if a tcc is already going with the frequency we want and our channel is unused.
    // tc's don't have enough channels to share.
    const pin_timer_t *timer = NULL;
    if (!variable_frequency) {
        for (uint8_t i = 0; i < TCC_INST_NUM && timer == NULL; i++) {
            if (target_tcc_frequencies[i] != frequency) {
                continue;
            }
            for (uint8_t j = 0; j < NUM_TIMERS_PER_PIN && timer == NULL; j++) {
                const pin_timer_t *t = &pin->timer[j];
                if (t->index != i || t->is_tc || t->index >= TCC_INST_NUM) {
                    continue;
                }
                if (tcc_enabled(t->index) && channel_ok(t)) {
                    timer = t;
                    // Claim channel.
                    tcc_channels[timer->index] |= (1 << tcc_channel(timer));
                    tcc_refcount[timer->index]++;
                }
            }
        }
    }

    // No existing timer has been found, so find a new one to use and set it up.
    if (timer == NULL) {
        // By default, with fixed frequency we want to share a TCC because its likely we'll have
        // other outputs at the same frequency. If the frequency is variable then we'll only have
        // one output so we start with the TCs to see if they work.
        int8_t direction = -1;
        uint8_t start = NUM_TIMERS_PER_PIN - 1;
        if (variable_frequency) {
            direction = 1;
            start = 0;
        }
        for (int8_t i = start; i >= 0 && i < NUM_TIMERS_PER_PIN && timer == NULL; i += direction) {
            const pin_timer_t *t = &pin->timer[i];
            if ((!t->is_tc && t->index >= TCC_INST_NUM) || (t->is_tc && t->index >= TC_INST_NUM)) {
                continue;
            }
            if (t->is_tc) {
                if (!tc_enabled(t->index) && t->wave_output == 1) {
                    timer = t;
                }
            } else {
                if (!tcc_enabled(t->index) && channel_ok(t)) {
                    timer = t;
                }
            }
        }

        if (timer == NULL) {
            return PWMOUT_INTERNAL_RESOURCES_IN_USE;
        }

        uint32_t top;
        uint8_t divisor;
        find_divisor(frequency, timer->is_tc ? 16 : tcc_sizes[timer->index], &top, &divisor);

        if (timer->is_tc) {
            tc_periods[timer->index] = top;
            tc_divisors[timer->index] = divisor;
            tc_set_enabled(timer->index, true);
        } else {
            tcc_periods[timer->index] = top;
            tcc_divisors[timer->index] = divisor;
            target_tcc_frequencies[timer->index] = frequency;
            tcc_refcount[timer->index]++;
            if (variable_frequency) {
                // We're changing frequency so claim all of the channels.
                tcc_channels[timer->index] = 0xff;
            } else {
                tcc_channels[timer->index] |= (1 << tcc_channel(timer));
            }
        }
    }

    self->timer = timer;
    self->pin = pin;
    claim_pin(pin);
    sim_pin_mode(pin->number, SIM_PIN_PWM, 0, 0);
    common_hal_pwmio_pwmout_set_duty_cycle(self, duty);
    return PWMOUT_OK;
}

bool common_hal_pwmio_pwmout_deinited(pwmio_pwmout_obj_t *self) {
    return self->pin == NULL;
}

void common_hal_pwmio_pwmout_deinit(pwmio_pwmout_obj_t *self) {
    if (common_hal_pwmio_pwmout_deinited(self)) {
        return;
    }
    const pin_timer_t *t = self->timer;
    if (t->is_tc) {
        tc_set_enabled(t->index, false);
    } else {
        tcc_refcount[t->index]--;
        // A variable frequency output claimed every channel, but only its own bit is cleared here.
        // The real driver has the same quirk: nothing else resets tcc_channels before power off.
        tcc_channels[t->index] &= ~(1 << tcc_channel(t));
        if (tcc_refcount[t->index] == 0) {
            target_tcc_frequencies[t->index] = 0;
        }
    }
    reset_pin_number(self->pin->number);
    self->pin = NULL;
}

void common_hal_pwmio_pwmout_set_duty_cycle(pwmio_pwmout_obj_t *self, uint16_t duty) {
    // Stored unadjusted because adjusting and reading back is lossy, as on the real board.
    self->duty_cycle = duty;
    const pin_timer_t *t = self->timer;
    if (t->is_tc) {
        self->compare = (uint16_t)(tc_periods[t->index] * duty / 0xffff);
    } else {
        self->compare = ((uint64_t)tcc_periods[t->index]) * duty / 0xffff;
    }
    update_host(self);
}

uint16_t common_hal_pwmio_pwmout_get_duty_cycle(pwmio_pwmout_obj_t *self) {
    const pin_timer_t *t = self->timer;
    if (t->is_tc) {
        return self->compare * 0xffffu / tc_periods[t->index];
    }
    return ((uint64_t)self->compare) * 0xffff / tcc_periods[t->index];
}

void common_hal_pwmio_pwmout_set_frequency(pwmio_pwmout_obj_t *self, uint32_t frequency) {
    uint32_t system_clock = common_hal_mcu_processor_get_frequency();
    if (frequency == 0 || frequency > system_clock / 2) {
        mp_arg_error_invalid(MP_QSTR_frequency);
    }
    const pin_timer_t *t = self->timer;
    uint32_t top;
    uint8_t divisor;
    find_divisor(frequency, t->is_tc ? 16 : tcc_sizes[t->index], &top, &divisor);
    if (t->is_tc) {
        tc_periods[t->index] = top;
        tc_divisors[t->index] = divisor;
    } else {
        tcc_periods[t->index] = top;
        tcc_divisors[t->index] = divisor;
    }
    common_hal_pwmio_pwmout_set_duty_cycle(self, self->duty_cycle);
}

uint32_t common_hal_pwmio_pwmout_get_frequency(pwmio_pwmout_obj_t *self) {
    uint32_t system_clock = common_hal_mcu_processor_get_frequency();
    const pin_timer_t *t = self->timer;
    uint8_t divisor = t->is_tc ? tc_divisors[t->index] : tcc_divisors[t->index];
    uint32_t top = t->is_tc ? tc_periods[t->index] : tcc_periods[t->index];
    return (system_clock / prescaler[divisor]) / (top + 1);
}

bool common_hal_pwmio_pwmout_get_variable_frequency(pwmio_pwmout_obj_t *self) {
    return self->variable_frequency;
}

const mcu_pin_obj_t *common_hal_pwmio_pwmout_get_pin(pwmio_pwmout_obj_t *self) {
    return self->pin;
}
