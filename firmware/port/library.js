// Forwards the C simulator interface in sim.h to Module.sim, supplied by the host.
addToLibrary({
  sim_serial_write: (ptr, len) => Module.sim.serialWrite(HEAPU8.slice(ptr, ptr + len)),
  sim_serial_available: () => Module.sim.serialAvailable(),
  sim_serial_peek: () => Module.sim.serialPeek(),
  sim_serial_read: () => Module.sim.serialRead(),
  sim_wait_ms: (ms) => Module.sim.waitMs(ms),
  sim_delay_us: (us) => Module.sim.delayUs?.(us),
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
  sim_spi_transfer: (clock, mosi, out, input, len, writeValue) => {
    const data = out ? HEAPU8.slice(out, out + len) : new Uint8Array(len).fill(writeValue);
    const result = Module.sim.spiTransfer(clock, data, mosi);
    if (input) HEAPU8.set(result.subarray(0, len), input);
  },
  sim_parallel_write: (data0, ptr, len) => Module.sim.parallelWrite(data0, HEAPU8.slice(ptr, ptr + len)),
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
  sim_touch_read: (pin) => Module.sim.touchRead(pin),
  sim_rtc_get: () => Module.sim.rtcGet(),
  sim_rtc_set: (seconds) => Module.sim.rtcSet(seconds),
  sim_nvm_read: (offset, out, len) => HEAPU8.set(Module.sim.nvmRead(offset, len).subarray(0, len), out),
  sim_nvm_write: (offset, ptr, len) => Module.sim.nvmWrite(offset, HEAPU8.slice(ptr, ptr + len)),
  sim_encoder_open: (pinA, pinB) => Module.sim.encoderOpen(pinA, pinB),
  sim_encoder_read: (id) => Module.sim.encoderRead(id),
  sim_encoder_write: (id, count) => Module.sim.encoderWrite(id, count),
  sim_encoder_close: (id) => Module.sim.encoderClose(id),
  sim_pulsein_open: (pin, idleState) => Module.sim.pulseinOpen(pin, idleState),
  sim_pulsein_resume: (id, triggerMicros) => Module.sim.pulseinResume(id, triggerMicros),
  sim_pulsein_pause: (id) => Module.sim.pulseinPause(id),
  sim_pulsein_clear: (id) => Module.sim.pulseinClear(id),
  sim_pulsein_count: (id) => Module.sim.pulseinCount(id),
  sim_pulsein_pop: (id) => Module.sim.pulseinPop(id),
  sim_pulsein_close: (id) => Module.sim.pulseinClose(id),
  sim_pulseout_send: (pin, frequency, duty, ptr, len) => Module.sim.pulseoutSend(pin, frequency, duty,
    new Uint16Array(HEAPU8.slice(ptr, ptr + len * 2).buffer)),
  sim_cdc_write: (ptr, len) => Module.sim.cdcWrite(HEAPU8.slice(ptr, ptr + len)),
  sim_cdc_available: () => Module.sim.cdcAvailable(),
  sim_cdc_read: () => Module.sim.cdcRead(),
  sim_hid_send: (reportId, ptr, len) => Module.sim.hidSend(reportId, HEAPU8.slice(ptr, ptr + len)),
  sim_midi_write: (ptr, len) => Module.sim.midiWrite(HEAPU8.slice(ptr, ptr + len)),
  sim_midi_available: () => Module.sim.midiAvailable(),
  sim_midi_read: () => Module.sim.midiRead(),
  sim_audio_start: (pin, sampleRate, channels) => Module.sim.audioStart(pin, sampleRate, channels),
  sim_audio_write: (ptr, count) => Module.sim.audioWrite(new Int16Array(HEAPU8.slice(ptr, ptr + count * 2).buffer)),
  sim_audio_stop: (pin) => Module.sim.audioStop(pin),
  sim_audio_pause: (pin, paused) => Module.sim.audioPause(pin, !!paused),
  sim_audio_buffered_ms: () => Module.sim.audioBufferedMs(),
  sim_i2s_start: (pin, sampleRate, channels) => Module.sim.i2sStart(pin, sampleRate, channels),
  sim_i2s_write: (ptr, count) => Module.sim.i2sWrite(new Int16Array(HEAPU8.slice(ptr, ptr + count * 2).buffer)),
  sim_i2s_stop: (pin) => Module.sim.i2sStop(pin),
  sim_i2s_pause: (pin, paused) => Module.sim.i2sPause(pin, !!paused),
  sim_i2s_buffered_ms: () => Module.sim.i2sBufferedMs(),
  sim_pdm_read: (out, count, sampleRate) => {
    const samples = Module.sim.pdmRead(count, sampleRate);
    HEAPU8.set(new Uint8Array(samples.buffer, samples.byteOffset, count * 2), out);
  },
});
