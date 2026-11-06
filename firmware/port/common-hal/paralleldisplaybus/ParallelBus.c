#include "shared-bindings/paralleldisplaybus/ParallelBus.h"

#include <stdint.h>

#include "common-hal/microcontroller/Pin.h"
#include "py/runtime.h"
#include "shared-bindings/digitalio/DigitalInOut.h"
#include "shared-bindings/microcontroller/__init__.h"
#include "shared-bindings/microcontroller/Pin.h"

#include "sim.h"

// Follows ports/atmel-samd/common-hal/paralleldisplaybus/ParallelBus.c. The real driver writes
// the data byte straight to one byte of a port register, which is why data0 must be aligned.

static void make_output(digitalio_digitalinout_obj_t *pin_obj, const mcu_pin_obj_t *pin) {
    pin_obj->base.type = &digitalio_digitalinout_type;
    common_hal_digitalio_digitalinout_construct(pin_obj, pin);
    common_hal_digitalio_digitalinout_switch_to_output(pin_obj, true, DRIVE_MODE_PUSH_PULL);
    common_hal_never_reset_pin(pin);
}

void common_hal_paralleldisplaybus_parallelbus_construct(paralleldisplaybus_parallelbus_obj_t *self,
    const mcu_pin_obj_t *data0, const mcu_pin_obj_t *command, const mcu_pin_obj_t *chip_select,
    const mcu_pin_obj_t *write, const mcu_pin_obj_t *read, const mcu_pin_obj_t *reset, uint32_t frequency) {
    // A failed construct keeps its display bus slot, so release_displays() still calls deinit.
    self->data0_pin = NO_PIN;

    uint8_t data_pin = data0->number;
    if (data_pin % 8 != 0) {
        mp_raise_ValueError(MP_ERROR_TEXT("Data 0 pin must be byte aligned"));
    }
    for (uint8_t i = 0; i < 8; i++) {
        if (!pin_number_is_free(data_pin + i)) {
            mp_raise_ValueError_varg(MP_ERROR_TEXT("Bus pin %d is already in use"), i);
        }
    }

    make_output(&self->command, command);
    make_output(&self->chip_select, chip_select);
    make_output(&self->write, write);

    self->read.base.type = &mp_type_NoneType;
    if (read != NULL) {
        make_output(&self->read, read);
    }

    self->data0_pin = data_pin;

    self->reset.base.type = &mp_type_NoneType;
    if (reset != NULL) {
        make_output(&self->reset, reset);
        common_hal_paralleldisplaybus_parallelbus_reset(self);
    }

    for (uint8_t i = 0; i < 8; i++) {
        common_hal_mcu_pin_claim_number(data_pin + i);
        never_reset_pin_number(data_pin + i);
        sim_pin_mode(data_pin + i, SIM_PIN_OUTPUT, 0, 0);
    }
}

void common_hal_paralleldisplaybus_parallelbus_deinit(paralleldisplaybus_parallelbus_obj_t *self) {
    if (self->data0_pin == NO_PIN) {
        return;
    }
    for (uint8_t i = 0; i < 8; i++) {
        reset_pin_number(self->data0_pin + i);
    }

    reset_pin_number(self->command.pin->number);
    reset_pin_number(self->chip_select.pin->number);
    reset_pin_number(self->write.pin->number);
    if (self->read.base.type != &mp_type_NoneType) {
        reset_pin_number(self->read.pin->number);
    }
    if (self->reset.base.type != &mp_type_NoneType) {
        reset_pin_number(self->reset.pin->number);
    }
}

bool common_hal_paralleldisplaybus_parallelbus_reset(mp_obj_t obj) {
    paralleldisplaybus_parallelbus_obj_t *self = MP_OBJ_TO_PTR(obj);
    if (self->reset.base.type == &mp_type_NoneType) {
        return false;
    }

    common_hal_digitalio_digitalinout_set_value(&self->reset, false);
    common_hal_mcu_delay_us(4);
    common_hal_digitalio_digitalinout_set_value(&self->reset, true);
    return true;
}

bool common_hal_paralleldisplaybus_parallelbus_bus_free(mp_obj_t obj) {
    return true;
}

bool common_hal_paralleldisplaybus_parallelbus_begin_transaction(mp_obj_t obj) {
    paralleldisplaybus_parallelbus_obj_t *self = MP_OBJ_TO_PTR(obj);
    common_hal_digitalio_digitalinout_set_value(&self->chip_select, false);
    return true;
}

void common_hal_paralleldisplaybus_parallelbus_send(mp_obj_t obj, display_byte_type_t byte_type,
    display_chip_select_behavior_t chip_select, const uint8_t *data, uint32_t data_length) {
    paralleldisplaybus_parallelbus_obj_t *self = MP_OBJ_TO_PTR(obj);
    common_hal_digitalio_digitalinout_set_value(&self->command, byte_type == DISPLAY_DATA);
    sim_parallel_write(self->data0_pin, data, data_length);
}

void common_hal_paralleldisplaybus_parallelbus_end_transaction(mp_obj_t obj) {
    paralleldisplaybus_parallelbus_obj_t *self = MP_OBJ_TO_PTR(obj);
    common_hal_digitalio_digitalinout_set_value(&self->chip_select, true);
}
