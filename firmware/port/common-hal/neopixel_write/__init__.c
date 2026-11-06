#include "shared-bindings/neopixel_write/__init__.h"

#include "sim.h"

void common_hal_neopixel_write(const digitalio_digitalinout_obj_t *digitalinout, uint8_t *pixels,
    uint32_t num_bytes) {
    sim_neopixel_write(digitalinout->pin->number, pixels, num_bytes);
}
