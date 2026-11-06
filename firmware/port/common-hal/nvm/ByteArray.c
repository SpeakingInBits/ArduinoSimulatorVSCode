#include "shared-bindings/nvm/ByteArray.h"

#include "sim.h"

uint32_t common_hal_nvm_bytearray_get_length(const nvm_bytearray_obj_t *self) {
    return self->len;
}

bool common_hal_nvm_bytearray_set_bytes(const nvm_bytearray_obj_t *self, uint32_t start_index,
    uint8_t *values, uint32_t len) {
    sim_nvm_write(start_index, values, len);
    return true;
}

void common_hal_nvm_bytearray_get_bytes(const nvm_bytearray_obj_t *self, uint32_t start_index,
    uint32_t len, uint8_t *values) {
    sim_nvm_read(start_index, values, len);
}
