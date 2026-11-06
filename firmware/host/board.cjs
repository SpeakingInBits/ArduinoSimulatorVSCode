// Host-side handle for a simulated board: starts the engine and exposes its inputs and events.
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const {
  CTRL, EVENT, createShared, ctrlView, inputView, adcView, touchView, eventView, rxView,
} = require('./shared-state.cjs');

const FIRMWARE = path.join(__dirname, '..', 'circuitpython', 'ports', 'webassembly',
  'build-metro_m0_express', 'firmware.js');

// Stands in for the M0's 32KB of SRAM minus .data, .bss and the stack. Calibrate against a real board.
const METRO_M0_PORT_HEAP_BYTES = 24 * 1024;

class Board extends EventEmitter {
  constructor({
    files, firmware = process.env.SIM_FIRMWARE ?? FIRMWARE, partsModule, partsConfig, i2cPullups = true,
    portHeapBytes = METRO_M0_PORT_HEAP_BYTES, nvm, rtcStart,
  }) {
    super();
    this.output = '';
    this.shared = createShared();
    this.ctrl = ctrlView(this.shared);
    this.inputs = inputView(this.shared);
    this.adc = adcView(this.shared);
    this.touch = touchView(this.shared);
    this.events = eventView(this.shared);
    this.rx = rxView(this.shared);
    const encoded = Object.entries(files).map(([filePath, text]) => ({
      path: filePath,
      data: typeof text === 'string' ? new TextEncoder().encode(text) : text,
    }));
    this.worker = new Worker(path.join(__dirname, 'engine-worker.cjs'), {
      workerData: {
        shared: this.shared, files: encoded, firmware, partsModule, partsConfig, i2cPullups, portHeapBytes, nvm, rtcStart,
      },
    });
    this.worker.on('message', (message) => this.handle(message));
    this.worker.on('error', (error) => this.emit('crash', String(error?.stack ?? error)));
  }

  handle(message) {
    if (message.type === 'serial') {
      const text = Buffer.from(message.data).toString('utf8');
      this.output += text;
      this.emit('serial', text);
    } else if (message.type === 'crash') {
      this.emit('crash', message.message);
    } else {
      this.emit(message.type, message);
    }
  }

  wake() {
    Atomics.add(this.ctrl, CTRL.WAKE, 1);
    Atomics.notify(this.ctrl, CTRL.WAKE);
  }

  // Sends text to the serial console, as if typed. "\x03" is Ctrl-C, which is how Stop works.
  write(text) {
    for (const byte of Buffer.from(text, 'utf8')) {
      const head = Atomics.load(this.ctrl, CTRL.RX_HEAD);
      this.rx[head] = byte;
      Atomics.store(this.ctrl, CTRL.RX_HEAD, (head + 1) % this.rx.length);
    }
    this.wake();
  }

  // Drives a pin from outside the board: 0, 1, or -1 for not connected.
  setPin(pin, level) {
    Atomics.store(this.inputs, pin, level);
  }

  // Sets the raw 12-bit ADC reading for a pin.
  setAdc(pin, value) {
    Atomics.store(this.adc, pin, value);
  }

  // Sets the raw touch reading for a pin, from 0 to 65535.
  setTouch(pin, value) {
    Atomics.store(this.touch, pin, value);
  }

  sendEvent(kind, a, b) {
    const head = Atomics.load(this.ctrl, CTRL.EVENT_HEAD);
    this.events.set([kind, a, b], head);
    Atomics.store(this.ctrl, CTRL.EVENT_HEAD, (head + 3) % this.events.length);
  }

  // Delivers finished pulses to any PulseIn on the pin, as lengths in microseconds.
  sendPulses(pin, lengths) {
    for (const length of lengths) this.sendEvent(EVENT.PULSE, pin, length);
  }

  // Delivers bytes to a UART receiving on the pin.
  sendUart(rxPin, bytes) {
    for (const byte of bytes) this.sendEvent(EVENT.UART, rxPin, byte);
  }

  // Delivers bytes to usb_cdc.data, as a program on the computer would.
  sendCdc(bytes) {
    for (const byte of bytes) this.sendEvent(EVENT.CDC, byte, 0);
  }

  // Delivers bytes to usb_midi.ports[0].
  sendMidi(bytes) {
    for (const byte of bytes) this.sendEvent(EVENT.MIDI, byte, 0);
  }

  // Turns an encoder by a signed number of quadrature edges. Four edges is one detent.
  turnEncoder(pinA, edges) {
    this.sendEvent(EVENT.ENCODER, pinA, edges);
  }

  waitForOutput(text, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.output.includes(text)) {
          clearTimeout(timer);
          this.off('serial', check);
          resolve(this.output);
        }
      };
      const timer = setTimeout(() => {
        this.off('serial', check);
        reject(new Error(`Timed out waiting for ${JSON.stringify(text)}. Output so far:\n${this.output}`));
      }, timeoutMs);
      this.on('serial', check);
      check();
    });
  }

  stop() {
    return this.worker.terminate();
  }
}

module.exports = { Board };
