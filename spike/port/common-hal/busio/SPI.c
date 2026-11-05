#include "py/runtime.h"
#include "shared-bindings/busio/SPI.h"
#include "shared-bindings/microcontroller/Pin.h"

#include "sim.h"

void common_hal_busio_spi_construct(busio_spi_obj_t *self, const mcu_pin_obj_t *clock,
    const mcu_pin_obj_t *mosi, const mcu_pin_obj_t *miso, bool half_duplex) {
    if (half_duplex) {
        mp_raise_NotImplementedError_varg(MP_ERROR_TEXT("%q"), MP_QSTR_half_duplex);
    }
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
    self->has_lock = false;
    self->baudrate = 250000;
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
    self->baudrate = baudrate;
    self->polarity = polarity;
    self->phase = phase;
    self->bits = bits;
    return true;
}

bool common_hal_busio_spi_try_lock(busio_spi_obj_t *self) {
    if (self->has_lock) {
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

bool common_hal_busio_spi_write(busio_spi_obj_t *self, const uint8_t *data, size_t len) {
    sim_spi_transfer(self->clock->number, data, NULL, len, 0);
    return true;
}

bool common_hal_busio_spi_read(busio_spi_obj_t *self, uint8_t *data, size_t len,
    uint8_t write_value) {
    sim_spi_transfer(self->clock->number, NULL, data, len, write_value);
    return true;
}

bool common_hal_busio_spi_transfer(busio_spi_obj_t *self, const uint8_t *data_out,
    uint8_t *data_in, size_t len) {
    sim_spi_transfer(self->clock->number, data_out, data_in, len, 0);
    return true;
}

uint32_t common_hal_busio_spi_get_frequency(busio_spi_obj_t *self) {
    return self->baudrate;
}

uint8_t common_hal_busio_spi_get_phase(busio_spi_obj_t *self) {
    return self->phase;
}

uint8_t common_hal_busio_spi_get_polarity(busio_spi_obj_t *self) {
    return self->polarity;
}

void common_hal_busio_spi_never_reset(busio_spi_obj_t *self) {
    common_hal_never_reset_pin(self->clock);
}
