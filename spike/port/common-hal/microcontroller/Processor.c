#include <math.h>
#include <string.h>

#include "common-hal/microcontroller/Processor.h"
#include "shared-bindings/microcontroller/Processor.h"
#include "shared-bindings/microcontroller/ResetReason.h"

float common_hal_mcu_processor_get_temperature(void) {
    return 25.0f;
}

float common_hal_mcu_processor_get_voltage(void) {
    return 3.3f;
}

uint32_t common_hal_mcu_processor_get_frequency(void) {
    return 48000000;
}

void common_hal_mcu_processor_get_uid(uint8_t raw_id[]) {
    memset(raw_id, 0x5A, COMMON_HAL_MCU_PROCESSOR_UID_LENGTH);
}

mcu_reset_reason_t common_hal_mcu_processor_get_reset_reason(void) {
    return MCU_RESET_REASON_POWER_ON;
}
