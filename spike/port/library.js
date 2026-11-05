// Forwards the C simulator interface in sim.h to Module.sim, supplied by the host.
addToLibrary({
  sim_serial_write: (ptr, len) => Module.sim.serialWrite(HEAPU8.slice(ptr, ptr + len)),
  sim_serial_available: () => Module.sim.serialAvailable(),
  sim_serial_peek: () => Module.sim.serialPeek(),
  sim_serial_read: () => Module.sim.serialRead(),
  sim_wait_ms: (ms) => Module.sim.waitMs(ms),
  sim_reset: (toBootloader) => Module.sim.reset(toBootloader),
  sim_port_heap_bytes: () => Module.sim.portHeapBytes,
  sim_pin_mode: (pin, mode, pull, openDrain) => Module.sim.pinMode(pin, mode, pull, openDrain),
  sim_pin_write: (pin, value) => Module.sim.pinWrite(pin, value),
  sim_pin_read: (pin) => Module.sim.pinRead(pin),
  sim_adc_read: (pin) => Module.sim.adcRead(pin),
  sim_dac_write: (pin, value) => Module.sim.dacWrite(pin, value),
  sim_pwm_set: (pin, frequency, duty) => Module.sim.pwmSet(pin, frequency, duty),
  sim_neopixel_write: (pin, ptr, len) => Module.sim.neopixelWrite(pin, HEAPU8.slice(ptr, ptr + len)),
  sim_i2c_pullups: (scl, sda) => Module.sim.i2cPullups(scl, sda),
  sim_i2c_probe: (address) => Module.sim.i2cProbe(address),
  sim_i2c_write: (address, ptr, len) => Module.sim.i2cWrite(address, HEAPU8.slice(ptr, ptr + len)),
  sim_i2c_read: (address, ptr, len) => Module.sim.i2cRead(address, HEAPU8.subarray(ptr, ptr + len)),
  sim_spi_transfer: (clock, out, input, len, writeValue) => {
    const data = out ? HEAPU8.slice(out, out + len) : new Uint8Array(len).fill(writeValue);
    const result = Module.sim.spiTransfer(clock, data);
    if (input) HEAPU8.set(result.subarray(0, len), input);
  },
  sim_uart_write: (tx, ptr, len) => Module.sim.uartWrite(tx, HEAPU8.slice(ptr, ptr + len)),
  sim_uart_available: (rx) => Module.sim.uartAvailable(rx),
  sim_uart_read: (rx) => Module.sim.uartRead(rx),
  sim_fs_count: () => Module.sim.files.length,
  sim_fs_name: (index, out, max) => {
    const bytes = new TextEncoder().encode(Module.sim.files[index].path);
    if (bytes.length + 1 > max) return -1;
    HEAPU8.set(bytes, out);
    HEAPU8[out + bytes.length] = 0;
    return bytes.length;
  },
  sim_fs_size: (index) => Module.sim.files[index].data.length,
  sim_fs_read: (index, out) => HEAPU8.set(Module.sim.files[index].data, out),
});
