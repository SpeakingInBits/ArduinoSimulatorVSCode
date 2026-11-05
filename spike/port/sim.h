// The boundary between CircuitPython and the simulator. Every call here is implemented
// in library.js, so swapping the simulator never touches the VM or the common-hal code.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Serial console.
void sim_serial_write(const char *text, uint32_t len);
uint32_t sim_serial_available(void);
int sim_serial_peek(void);
int sim_serial_read(void);

// Time and control.
void sim_wait_ms(double ms);
void sim_reset(int to_bootloader);
uint32_t sim_port_heap_bytes(void);

// Pins. mode is one of the SIM_PIN_* values.
enum { SIM_PIN_OFF, SIM_PIN_INPUT, SIM_PIN_OUTPUT, SIM_PIN_ANALOG_IN, SIM_PIN_ANALOG_OUT, SIM_PIN_PWM };
void sim_pin_mode(int pin, int mode, int pull, int open_drain);
void sim_pin_write(int pin, int value);
int sim_pin_read(int pin);
int sim_adc_read(int pin);
void sim_dac_write(int pin, int value);
void sim_pwm_set(int pin, int frequency, int duty);
void sim_neopixel_write(int pin, const uint8_t *pixels, uint32_t len);

// Buses. Return 0 on success or a positive errno.
int sim_i2c_pullups(int scl, int sda);
int sim_i2c_probe(int address);
int sim_i2c_write(int address, const uint8_t *data, uint32_t len);
int sim_i2c_read(int address, uint8_t *data, uint32_t len);
void sim_spi_transfer(int clock, const uint8_t *out, uint8_t *in, uint32_t len, int write_value);
void sim_uart_write(int tx, const uint8_t *data, uint32_t len);
uint32_t sim_uart_available(int rx);
int sim_uart_read(int rx);

// Student files, copied onto CIRCUITPY at startup.
int sim_fs_count(void);
int sim_fs_name(int index, char *out, uint32_t max);
int sim_fs_size(int index);
void sim_fs_read(int index, uint8_t *out);
