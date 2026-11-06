#include "peripherals/resources.h"
#include "py/mperrno.h"
#include "py/runtime.h"
#include "shared-bindings/busio/I2C.h"
#include "shared-bindings/microcontroller/Pin.h"

#include "sim.h"

// Same search as samd_i2c_get_sercom(): SDA on pad 0 and SCL on pad 1 of one free SERCOM.
static uint8_t find_sercom(const mcu_pin_obj_t *scl, const mcu_pin_obj_t *sda) {
    for (int i = 0; i < 2; i++) {
        uint8_t sercom_index = sda->sercom[i].index;
        if (sercom_index >= SERCOM_INST_NUM) {
            continue;
        }
        if (sercom_enabled(sercom_index) || sda->sercom[i].pad != 0) {
            continue;
        }
        for (int j = 0; j < 2; j++) {
            if (sercom_index == scl->sercom[j].index && scl->sercom[j].pad == 1) {
                return sercom_index;
            }
        }
    }
    return SERCOM_INST_NUM;
}

void common_hal_busio_i2c_construct(busio_i2c_obj_t *self, const mcu_pin_obj_t *scl,
    const mcu_pin_obj_t *sda, uint32_t frequency, uint32_t timeout_ms) {
    self->sda = NULL;
    uint8_t sercom_index = find_sercom(scl, sda);
    if (sercom_index >= SERCOM_INST_NUM) {
        raise_ValueError_invalid_pins();
    }
    #if CIRCUITPY_REQUIRE_I2C_PULLUPS
    if (!sim_i2c_pullups(scl->number, sda->number)) {
        mp_raise_RuntimeError(MP_ERROR_TEXT("No pull up found on SDA or SCL; check your wiring"));
    }
    #endif
    if (frequency < 95000) {
        mp_arg_error_invalid(MP_QSTR_frequency);
    }
    sercom_set_enabled(sercom_index, true);
    self->sercom_index = sercom_index;
    claim_pin(sda);
    claim_pin(scl);
    self->sda = sda;
    self->scl = scl;
    self->has_lock = false;
}

bool common_hal_busio_i2c_deinited(busio_i2c_obj_t *self) {
    return self->sda == NULL;
}

void common_hal_busio_i2c_mark_deinit(busio_i2c_obj_t *self) {
    self->sda = NULL;
}

void common_hal_busio_i2c_deinit(busio_i2c_obj_t *self) {
    if (common_hal_busio_i2c_deinited(self)) {
        return;
    }
    sercom_set_enabled(self->sercom_index, false);
    reset_pin_number(self->sda->number);
    reset_pin_number(self->scl->number);
    common_hal_busio_i2c_mark_deinit(self);
}

bool common_hal_busio_i2c_try_lock(busio_i2c_obj_t *self) {
    if (self->has_lock) {
        return false;
    }
    self->has_lock = true;
    return true;
}

bool common_hal_busio_i2c_has_lock(busio_i2c_obj_t *self) {
    return self->has_lock;
}

void common_hal_busio_i2c_unlock(busio_i2c_obj_t *self) {
    self->has_lock = false;
}

bool common_hal_busio_i2c_probe(busio_i2c_obj_t *self, uint8_t addr) {
    return sim_i2c_probe(addr);
}

mp_negative_errno_t common_hal_busio_i2c_write(busio_i2c_obj_t *self, uint16_t addr,
    const uint8_t *data, size_t len) {
    return -sim_i2c_write(addr, data, len);
}

mp_negative_errno_t common_hal_busio_i2c_read(busio_i2c_obj_t *self, uint16_t addr, uint8_t *data,
    size_t len) {
    return -sim_i2c_read(addr, data, len);
}

mp_negative_errno_t common_hal_busio_i2c_write_read(busio_i2c_obj_t *self, uint16_t addr,
    uint8_t *out_data, size_t out_len, uint8_t *in_data, size_t in_len) {
    mp_negative_errno_t result = common_hal_busio_i2c_write(self, addr, out_data, out_len);
    if (result != 0) {
        return result;
    }
    return common_hal_busio_i2c_read(self, addr, in_data, in_len);
}

void common_hal_busio_i2c_never_reset(busio_i2c_obj_t *self) {
    common_hal_never_reset_pin(self->sda);
    common_hal_never_reset_pin(self->scl);
}
