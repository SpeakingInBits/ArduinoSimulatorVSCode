#include "py/mperrno.h"
#include "py/mphal.h"
#include "py/runtime.h"
#include "py/stream.h"
#include "shared-bindings/busio/UART.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared/runtime/interrupt_char.h"
#include "supervisor/shared/tick.h"

#include "sim.h"

void common_hal_busio_uart_construct(busio_uart_obj_t *self, const mcu_pin_obj_t *tx,
    const mcu_pin_obj_t *rx, const mcu_pin_obj_t *rts, const mcu_pin_obj_t *cts,
    const mcu_pin_obj_t *rs485_dir, bool rs485_invert, uint32_t baudrate, uint8_t bits,
    busio_uart_parity_t parity, uint8_t stop, mp_float_t timeout, uint16_t receiver_buffer_size,
    byte *receiver_buffer, bool sigint_enabled) {
    if (rs485_dir != NULL) {
        mp_raise_NotImplementedError(MP_ERROR_TEXT("RS485"));
    }
    if (tx != NULL) {
        claim_pin(tx);
    }
    if (rx != NULL) {
        claim_pin(rx);
    }
    self->tx = tx;
    self->rx = rx;
    self->baudrate = baudrate;
    self->timeout = timeout;
    self->active = true;
}

bool common_hal_busio_uart_deinited(busio_uart_obj_t *self) {
    return !self->active;
}

void common_hal_busio_uart_deinit(busio_uart_obj_t *self) {
    if (common_hal_busio_uart_deinited(self)) {
        return;
    }
    if (self->tx != NULL) {
        reset_pin_number(self->tx->number);
    }
    if (self->rx != NULL) {
        reset_pin_number(self->rx->number);
    }
    self->active = false;
}

size_t common_hal_busio_uart_read(busio_uart_obj_t *self, uint8_t *data, size_t len,
    int *errcode) {
    if (self->rx == NULL) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("No %q pin"), MP_QSTR_rx);
    }
    uint64_t deadline = supervisor_ticks_ms64() + (uint64_t)(self->timeout * 1000);
    size_t count = 0;
    while (count < len) {
        if (sim_uart_available(self->rx->number) > 0) {
            data[count++] = sim_uart_read(self->rx->number);
        } else if (supervisor_ticks_ms64() >= deadline) {
            break;
        } else {
            RUN_BACKGROUND_TASKS;
            if (mp_hal_is_interrupted()) {
                break;
            }
        }
    }
    if (count == 0) {
        *errcode = MP_EAGAIN;
        return MP_STREAM_ERROR;
    }
    return count;
}

size_t common_hal_busio_uart_write(busio_uart_obj_t *self, const uint8_t *data, size_t len,
    int *errcode) {
    if (self->tx == NULL) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("No %q pin"), MP_QSTR_tx);
    }
    sim_uart_write(self->tx->number, data, len);
    return len;
}

uint32_t common_hal_busio_uart_get_baudrate(busio_uart_obj_t *self) {
    return self->baudrate;
}

void common_hal_busio_uart_set_baudrate(busio_uart_obj_t *self, uint32_t baudrate) {
    self->baudrate = baudrate;
}

mp_float_t common_hal_busio_uart_get_timeout(busio_uart_obj_t *self) {
    return self->timeout;
}

void common_hal_busio_uart_set_timeout(busio_uart_obj_t *self, mp_float_t timeout) {
    self->timeout = timeout;
}

uint32_t common_hal_busio_uart_rx_characters_available(busio_uart_obj_t *self) {
    return self->rx == NULL ? 0 : sim_uart_available(self->rx->number);
}

void common_hal_busio_uart_clear_rx_buffer(busio_uart_obj_t *self) {
    while (self->rx != NULL && sim_uart_available(self->rx->number) > 0) {
        sim_uart_read(self->rx->number);
    }
}

bool common_hal_busio_uart_ready_to_tx(busio_uart_obj_t *self) {
    return true;
}

void common_hal_busio_uart_never_reset(busio_uart_obj_t *self) {
    if (self->tx != NULL) {
        common_hal_never_reset_pin(self->tx);
    }
    if (self->rx != NULL) {
        common_hal_never_reset_pin(self->rx);
    }
}
