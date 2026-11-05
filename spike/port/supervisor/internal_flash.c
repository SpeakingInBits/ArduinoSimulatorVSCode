// CIRCUITPY lives in RAM here, sized like the Metro M0 Express's 2MB SPI flash.
#include <stdint.h>
#include <string.h>

#include "supervisor/flash.h"
#include "supervisor/internal_flash.h"

#define BLOCK_SIZE 512

static uint8_t flash[SIM_FLASH_BYTES];

void supervisor_flash_init(void) {
}

uint32_t supervisor_flash_get_block_size(void) {
    return BLOCK_SIZE;
}

uint32_t supervisor_flash_get_block_count(void) {
    return SIM_FLASH_BYTES / BLOCK_SIZE;
}

void port_internal_flash_flush(void) {
}

mp_uint_t supervisor_flash_read_blocks(uint8_t *dest, uint32_t block, uint32_t num_blocks) {
    memcpy(dest, flash + block * BLOCK_SIZE, num_blocks * BLOCK_SIZE);
    return 0;
}

mp_uint_t supervisor_flash_write_blocks(const uint8_t *src, uint32_t block, uint32_t num_blocks) {
    memcpy(flash + block * BLOCK_SIZE, src, num_blocks * BLOCK_SIZE);
    return 0;
}

void supervisor_flash_release_cache(void) {
}
