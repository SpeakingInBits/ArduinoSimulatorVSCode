#include "py/mperrno.h"
#include "py/runtime.h"
#include "shared-bindings/busio/I2C.h"
#include "shared-bindings/microcontroller/Pin.h"

#include "sim.h"

// Same rule as samd_i2c_get_sercom(): SDA on pad 0 and SCL on pad 1 of one SERCOM.
static bool pins_share_i2c_sercom(const mcu_pin_obj_t *scl, const mcu_pin_obj_t *sda) {
    for (int i = 0; i < 2; i++) {
        if (sda->sercom[i][0] == 0xff || sda->sercom[i][1] != 0) {
            continue;
        }
        for (int j = 0; j < 2; j++) {
            if (scl->sercom[j][0] == sda->sercom[i][0] && scl->sercom[j][1] == 1) {
                return true;
            }
        }
    }
    return false;
}

void common_hal_busio_i2c_construct(busio_i2c_obj_t *self, const mcu_pin_obj_t *scl,
    const mcu_pin_obj_t *sda, uint32_t frequency, uint32_t timeout_ms) {
    self->sda = NULL;
    if (!pins_share_i2c_sercom(scl, sda)) {
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
