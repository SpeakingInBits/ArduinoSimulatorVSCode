#include "background.h"
#include "peripherals/resources.h"
#include "py/gc.h"
#include "py/mperrno.h"
#include "py/mphal.h"
#include "py/runtime.h"
#include "py/stream.h"
#include "shared-bindings/busio/UART.h"
#include "shared-bindings/microcontroller/Pin.h"
#include "shared/runtime/interrupt_char.h"
#include "supervisor/shared/tick.h"

#include "sim.h"

// Pin rules and read behaviour follow ports/atmel-samd/common-hal/busio/UART.c (SAMD21 branches).

// Returns SERCOM_INST_NUM when no free SERCOM connects these pins.
static uint8_t find_sercom(const mcu_pin_obj_t *tx, const mcu_pin_obj_t *rx,
    const mcu_pin_obj_t *rts, const mcu_pin_obj_t *cts) {
    bool have_tx = tx != NULL;
    bool have_rx = rx != NULL;
    bool have_rts = rts != NULL;
    bool have_cts = cts != NULL;
    uint8_t tx_pad = 255;
    uint8_t sercom_index = 255;

    for (int i = 0; i < 2; i++) {
        if (have_tx) {
            sercom_index = tx->sercom[i].index;
            if (sercom_index >= SERCOM_INST_NUM) {
                continue;
            }
            if (sercom_enabled(sercom_index)) {
                continue;
            }
            // TX must be on pad 0 or 2.
            if (tx->sercom[i].pad != 0 && tx->sercom[i].pad != 2) {
                continue;
            }
            // RTS must be on pad 2, so if TX is also on pad 2, not possible.
            if (have_rts && (rts->sercom[i].pad != 2 || tx->sercom[i].pad == 2)) {
                continue;
            }
            // CTS must be on pad 3, so if RX is also on pad 3, not possible.
            if (have_cts && (cts->sercom[i].pad != 3 || (have_rx && rx->sercom[i].pad == 3))) {
                continue;
            }
            tx_pad = tx->sercom[i].pad;
            if (!have_rx) {
                // TX only, so don't need to look further.
                return sercom_index;
            }
        }

        // Have TX, now look for RX match. We know have_rx is true at this point.
        for (int j = 0; j < 2; j++) {
            if (((!have_tx && rx->sercom[j].index < SERCOM_INST_NUM &&
                  !sercom_enabled(rx->sercom[j].index)) ||
                 sercom_index == rx->sercom[j].index) &&
                rx->sercom[j].pad != tx_pad) {
                return rx->sercom[j].index;
            }
        }
    }
    return SERCOM_INST_NUM;
}

void common_hal_busio_uart_construct(busio_uart_obj_t *self, const mcu_pin_obj_t *tx,
    const mcu_pin_obj_t *rx, const mcu_pin_obj_t *rts, const mcu_pin_obj_t *cts,
    const mcu_pin_obj_t *rs485_dir, bool rs485_invert, uint32_t baudrate, uint8_t bits,
    busio_uart_parity_t parity, uint8_t stop, mp_float_t timeout, uint16_t receiver_buffer_size,
    byte *receiver_buffer, bool sigint_enabled) {
    // Set state so the object is deinited to start.
    self->tx = NULL;
    self->rx = NULL;
    self->rts = NULL;
    self->cts = NULL;

    if ((rs485_dir != NULL) || (rs485_invert)) {
        mp_raise_NotImplementedError(MP_ERROR_TEXT("RS485"));
    }

    mp_arg_validate_int_max(bits, 8, MP_QSTR_bits);

    bool have_rx = rx != NULL;
    if (have_rx && receiver_buffer_size > 0 && (receiver_buffer_size & (receiver_buffer_size - 1)) != 0) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("%q must be power of 2"), MP_QSTR_receiver_buffer_size);
    }

    uint8_t sercom_index = find_sercom(tx, rx, rts, cts);
    if (sercom_index >= SERCOM_INST_NUM) {
        raise_ValueError_invalid_pins();
    }

    self->buffer = NULL;
    self->buffer_length = 0;
    if (have_rx && receiver_buffer_size > 0) {
        self->buffer_length = receiver_buffer_size;
        if (receiver_buffer != NULL) {
            self->buffer = receiver_buffer;
        } else {
            self->buffer = (uint8_t *)gc_alloc(self->buffer_length, false);
            if (self->buffer == NULL) {
                m_malloc_fail(self->buffer_length);
            }
        }
    }
    self->read_index = 0;
    self->write_index = 0;

    sercom_set_enabled(sercom_index, true);
    self->sercom_index = sercom_index;
    self->baudrate = baudrate;
    self->frame_bits = 1 + bits + (parity == BUSIO_UART_PARITY_NONE ? 0 : 1) + stop;
    self->timeout_ms = timeout * 1000;
    if (tx != NULL) {
        claim_pin(tx);
    }
    if (rx != NULL) {
        claim_pin(rx);
    }
    if (rts != NULL) {
        claim_pin(rts);
    }
    if (cts != NULL) {
        claim_pin(cts);
    }
    self->tx = tx;
    self->rx = rx;
    self->rts = rts;
    self->cts = cts;
}

bool common_hal_busio_uart_deinited(busio_uart_obj_t *self) {
    return self->rx == NULL && self->tx == NULL;
}

void common_hal_busio_uart_deinit(busio_uart_obj_t *self) {
    if (common_hal_busio_uart_deinited(self)) {
        return;
    }
    sercom_set_enabled(self->sercom_index, false);
    const mcu_pin_obj_t *pins[] = { self->tx, self->rx, self->rts, self->cts };
    for (size_t i = 0; i < MP_ARRAY_SIZE(pins); i++) {
        if (pins[i] != NULL) {
            reset_pin_number(pins[i]->number);
        }
    }
    self->tx = NULL;
    self->rx = NULL;
    self->rts = NULL;
    self->cts = NULL;
}

// There are no interrupts, so received bytes are collected whenever Python looks at the UART.
// Keeps the newest bytes when the ring overflows, as the ASF4 ring buffer does.
static void collect_rx(busio_uart_obj_t *self) {
    while (self->buffer_length > 0 && sim_uart_available(self->rx->number) > 0) {
        self->buffer[self->write_index % self->buffer_length] = sim_uart_read(self->rx->number);
        self->write_index++;
        if (self->write_index - self->read_index > self->buffer_length) {
            self->read_index = self->write_index - self->buffer_length;
        }
    }
}

size_t common_hal_busio_uart_read(busio_uart_obj_t *self, uint8_t *data, size_t len,
    int *errcode) {
    if (self->rx == NULL) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("No %q pin"), MP_QSTR_rx);
    }
    if (len == 0) {
        // Nothing to read.
        return 0;
    }

    size_t total_read = 0;
    uint64_t start_ticks = supervisor_ticks_ms64();

    // Busy-wait until timeout or until we've read enough chars.
    while (supervisor_ticks_ms64() - start_ticks <= self->timeout_ms) {
        // Read as many chars as we can right now, up to len.
        collect_rx(self);
        size_t num_read = 0;
        while (num_read < len && self->read_index != self->write_index) {
            data[num_read++] = self->buffer[self->read_index++ % self->buffer_length];
        }

        // Advance pointer in data buffer, and decrease how many chars left to read.
        data += num_read;
        len -= num_read;
        total_read += num_read;
        if (len == 0) {
            // Don't need to read any more: data buf is full.
            break;
        }
        if (num_read > 0) {
            // Reset the timeout on every character read.
            start_ticks = supervisor_ticks_ms64();
        }
        RUN_BACKGROUND_TASKS;
        // Allow user to break out of a timeout with a KeyboardInterrupt.
        if (mp_hal_is_interrupted()) {
            break;
        }
        // If we are zero timeout, make sure we don't loop again (in the event
        // we read in under 1ms)
        if (self->timeout_ms == 0) {
            break;
        }
    }

    if (total_read == 0) {
        *errcode = MP_EAGAIN;
        return MP_STREAM_ERROR;
    }
    return total_read;
}

size_t common_hal_busio_uart_write(busio_uart_obj_t *self, const uint8_t *data, size_t len,
    int *errcode) {
    if (self->tx == NULL) {
        mp_raise_ValueError_varg(MP_ERROR_TEXT("No %q pin"), MP_QSTR_tx);
    }
    sim_uart_write(self->tx->number, data, len);
    // The real write busy-waits until all characters are transmitted.
    sim_wait_us((uint64_t)len * self->frame_bits * 1000000 / self->baudrate);
    return len;
}

uint32_t common_hal_busio_uart_get_baudrate(busio_uart_obj_t *self) {
    return self->baudrate;
}

void common_hal_busio_uart_set_baudrate(busio_uart_obj_t *self, uint32_t baudrate) {
    self->baudrate = baudrate;
}

mp_float_t common_hal_busio_uart_get_timeout(busio_uart_obj_t *self) {
    return (mp_float_t)(self->timeout_ms / 1000.0f);
}

void common_hal_busio_uart_set_timeout(busio_uart_obj_t *self, mp_float_t timeout) {
    self->timeout_ms = timeout * 1000;
}

uint32_t common_hal_busio_uart_rx_characters_available(busio_uart_obj_t *self) {
    if (self->rx == NULL) {
        return 0;
    }
    collect_rx(self);
    return self->write_index - self->read_index;
}

void common_hal_busio_uart_clear_rx_buffer(busio_uart_obj_t *self) {
    if (self->rx != NULL) {
        collect_rx(self);
    }
    self->read_index = self->write_index;
}

// Writes finish before common_hal_busio_uart_write() returns, so only the pin can be missing.
bool common_hal_busio_uart_ready_to_tx(busio_uart_obj_t *self) {
    return self->tx != NULL;
}

void common_hal_busio_uart_never_reset(busio_uart_obj_t *self) {
    const mcu_pin_obj_t *pins[] = { self->tx, self->rx, self->rts, self->cts };
    for (size_t i = 0; i < MP_ARRAY_SIZE(pins); i++) {
        if (pins[i] != NULL) {
            common_hal_never_reset_pin(pins[i]);
        }
    }
}
