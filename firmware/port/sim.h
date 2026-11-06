// The boundary between CircuitPython and the simulator. Every call here is implemented
// in library.js, so swapping the simulator never touches the VM or the common-hal code.
// firmware/SIM_INTERFACE.md describes what the host must do for each one.
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
void sim_delay_us(uint32_t us);
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
// mosi is -1 for a bus with no data out pin.
void sim_spi_transfer(int clock, int mosi, const uint8_t *out, uint8_t *in, uint32_t len, int write_value);
void sim_parallel_write(int data0, const uint8_t *data, uint32_t len);
void sim_uart_write(int tx, const uint8_t *data, uint32_t len);
uint32_t sim_uart_available(int rx);
int sim_uart_read(int rx);

// Student files, copied onto CIRCUITPY at startup.
int sim_fs_count(void);
int sim_fs_name(int index, char *out, uint32_t max);
int sim_fs_size(int index);
void sim_fs_read(int index, uint8_t *out);

// touchio: a raw reading from 0 to 65535.
int sim_touch_read(int pin);

// rtc: seconds since 1970.
double sim_rtc_get(void);
void sim_rtc_set(double seconds);

// nvm.
void sim_nvm_read(uint32_t offset, uint8_t *out, uint32_t len);
void sim_nvm_write(uint32_t offset, const uint8_t *data, uint32_t len);

// rotaryio: the host decodes the quadrature signal and counts edges.
int sim_encoder_open(int pin_a, int pin_b);
int32_t sim_encoder_read(int id);
void sim_encoder_write(int id, int32_t count);
void sim_encoder_close(int id);

// pulseio. Times are in microseconds.
int sim_pulsein_open(int pin, int idle_state);
void sim_pulsein_resume(int id, int trigger_us);
void sim_pulsein_pause(int id);
void sim_pulsein_clear(int id);
int sim_pulsein_count(int id);
int sim_pulsein_pop(int id);
void sim_pulsein_close(int id);
void sim_pulseout_send(int pin, int frequency, int duty, const uint16_t *pulses, uint32_t len);

// usb_cdc.data, usb_hid and usb_midi.
void sim_cdc_write(const uint8_t *data, uint32_t len);
uint32_t sim_cdc_available(void);
int sim_cdc_read(void);
void sim_hid_send(int report_id, const uint8_t *report, uint32_t len);
void sim_midi_write(const uint8_t *data, uint32_t len);
uint32_t sim_midi_available(void);
int sim_midi_read(void);

// audioio. Samples are signed 16 bit, with channels interleaved.
void sim_audio_start(int pin, uint32_t sample_rate, int channels);
void sim_audio_write(const int16_t *samples, uint32_t count);
void sim_audio_stop(int pin);
void sim_audio_pause(int pin, bool paused);
uint32_t sim_audio_buffered_ms(void);

// audiobusio. The pin is the I2S data pin.
void sim_i2s_start(int pin, uint32_t sample_rate, int channels);
void sim_i2s_write(const int16_t *samples, uint32_t count);
void sim_i2s_stop(int pin);
void sim_i2s_pause(int pin, bool paused);
uint32_t sim_i2s_buffered_ms(void);
void sim_pdm_read(int16_t *out, uint32_t count, uint32_t sample_rate);
