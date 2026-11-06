#include "peripherals/resources.h"
#include "py/runtime.h"
#include "shared-bindings/busio/SPI.h"
#include "shared-bindings/microcontroller/Pin.h"

#include "sim.h"

// Pin rules and baud rates follow ports/atmel-samd/common-hal/busio/SPI.c and samd-peripherals.

#define SERCOM_CLOCK_HZ 48000000

// A hardware limit: only these clock and data-out pad pairings exist. 0xff means not possible.
static uint8_t get_spi_dopo(uint8_t clock_pad, uint8_t mosi_pad) {
    if (clock_pad == 1) {
        if (mosi_pad == 0) {
            return 0;
        } else if (mosi_pad == 3) {
            return 2;
        }
    } else if (clock_pad == 3) {
        if (mosi_pad == 0) {
            return 3;
        } else if (mosi_pad == 2) {
            return 1;
        }
    }
    return 0xff;
}

static bool valid_spi_clock_pad(uint8_t clock_pad) {
    return clock_pad == 1 || clock_pad == 3;
}

// The requested rate is a ceiling: the result is that rate or the nearest lower one available.
static uint8_t baudrate_to_baud_reg_value(uint32_t baudrate) {
    uint32_t divisor = 2 * baudrate;
    uint32_t baud_reg_value = (SERCOM_CLOCK_HZ + divisor - 1) / divisor - 1;
    return baud_reg_value > 255 ? 255 : baud_reg_value;
}

// Returns SERCOM_INST_NUM when no free SERCOM connects these pins.
static uint8_t find_sercom(const mcu_pin_obj_t *clock, const mcu_pin_obj_t *mosi,
    const mcu_pin_obj_t *miso) {
    bool mosi_none = mosi == NULL;
    bool miso_none = miso == NULL;
    for (int i = 0; i < 2; i++) {
        uint8_t sercom_index = clock->sercom[i].index;
        if (sercom_index >= SERCOM_INST_NUM || sercom_enabled(sercom_index)) {
            continue;
        }
        uint8_t clock_pad = clock->sercom[i].pad;
        if (!valid_spi_clock_pad(clock_pad)) {
            continue;
        }
        // Find mosi_pad first, since it corresponds to dopo which takes limited values.
        for (int j = 0; j < 2; j++) {
            if (!mosi_none) {
                if (sercom_index != mosi->sercom[j].index) {
                    continue;
                }
                if (get_spi_dopo(clock_pad, mosi->sercom[j].pad) > 0x3) {
                    continue;
                }
                if (miso_none) {
                    return sercom_index;
                }
            }
            if (!miso_none) {
                for (int k = 0; k < 2; k++) {
                    if (sercom_index == miso->sercom[k].index) {
                        return sercom_index;
                    }
                }
            }
        }
    }
    return SERCOM_INST_NUM;
}

void common_hal_busio_spi_construct(busio_spi_obj_t *self, const mcu_pin_obj_t *clock,
    const mcu_pin_obj_t *mosi, const mcu_pin_obj_t *miso, bool half_duplex) {
    if (half_duplex) {
        mp_raise_NotImplementedError_varg(MP_ERROR_TEXT("%q"), MP_QSTR_half_duplex);
    }

    // Ensure the object starts in its deinit state.
    common_hal_busio_spi_mark_deinit(self);

    uint8_t sercom_index = find_sercom(clock, mosi, miso);
    if (sercom_index >= SERCOM_INST_NUM) {
        raise_ValueError_invalid_pins();
    }
    sercom_set_enabled(sercom_index, true);

    claim_pin(clock);
    if (mosi != NULL) {
        claim_pin(mosi);
    }
    if (miso != NULL) {
        claim_pin(miso);
    }
    self->clock = clock;
    self->mosi = mosi;
    self->miso = miso;
    self->sercom_index = sercom_index;
    self->has_lock = false;
    // Always start at 250khz which is what SD cards need.
    self->baud_reg_value = baudrate_to_baud_reg_value(250000);
    self->polarity = 0;
    self->phase = 0;
    self->bits = 8;
}

bool common_hal_busio_spi_deinited(busio_spi_obj_t *self) {
    return self->clock == NULL;
}

void common_hal_busio_spi_mark_deinit(busio_spi_obj_t *self) {
    self->clock = NULL;
}

void common_hal_busio_spi_deinit(busio_spi_obj_t *self) {
    if (common_hal_busio_spi_deinited(self)) {
        return;
    }
    sercom_set_enabled(self->sercom_index, false);
    reset_pin_number(self->clock->number);
    if (self->mosi != NULL) {
        reset_pin_number(self->mosi->number);
    }
    if (self->miso != NULL) {
        reset_pin_number(self->miso->number);
    }
    common_hal_busio_spi_mark_deinit(self);
}

bool common_hal_busio_spi_configure(busio_spi_obj_t *self, uint32_t baudrate, uint8_t polarity,
    uint8_t phase, uint8_t bits) {
    self->baud_reg_value = baudrate_to_baud_reg_value(baudrate);
    self->polarity = polarity;
    self->phase = phase;
    self->bits = bits;
    return true;
}

bool common_hal_busio_spi_try_lock(busio_spi_obj_t *self) {
    if (common_hal_busio_spi_deinited(self) || self->has_lock) {
        return false;
    }
    self->has_lock = true;
    return true;
}

bool common_hal_busio_spi_has_lock(busio_spi_obj_t *self) {
    return self->has_lock;
}

void common_hal_busio_spi_unlock(busio_spi_obj_t *self) {
    self->has_lock = false;
}

static int mosi_number(busio_spi_obj_t *self) {
    return self->mosi != NULL ? self->mosi->number : -1;
}

bool common_hal_busio_spi_write(busio_spi_obj_t *self, const uint8_t *data, size_t len) {
    if (len > 0) {
        sim_spi_transfer(self->clock->number, mosi_number(self), data, NULL, len, 0);
    }
    return true;
}

bool common_hal_busio_spi_read(busio_spi_obj_t *self, uint8_t *data, size_t len,
    uint8_t write_value) {
    if (len > 0) {
        sim_spi_transfer(self->clock->number, mosi_number(self), NULL, data, len, write_value);
    }
    return true;
}

bool common_hal_busio_spi_transfer(busio_spi_obj_t *self, const uint8_t *data_out,
    uint8_t *data_in, size_t len) {
    if (len > 0) {
        sim_spi_transfer(self->clock->number, mosi_number(self), data_out, data_in, len, 0);
    }
    return true;
}

uint32_t common_hal_busio_spi_get_frequency(busio_spi_obj_t *self) {
    return SERCOM_CLOCK_HZ / (2 * (self->baud_reg_value + 1));
}

uint8_t common_hal_busio_spi_get_phase(busio_spi_obj_t *self) {
    return self->phase;
}

uint8_t common_hal_busio_spi_get_polarity(busio_spi_obj_t *self) {
    return self->polarity;
}

void common_hal_busio_spi_never_reset(busio_spi_obj_t *self) {
    common_hal_never_reset_pin(self->clock);
    if (self->mosi != NULL) {
        common_hal_never_reset_pin(self->mosi);
    }
    if (self->miso != NULL) {
        common_hal_never_reset_pin(self->miso);
    }
}
