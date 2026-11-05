// Runs CircuitPython in a worker thread. The thread blocks inside WebAssembly, so it can
// never receive messages: everything the outside world changes arrives through shared memory.
const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const { CTRL, ctrlView, inputView, adcView, rxView } = require('./shared-state.cjs');

const ctrl = ctrlView(workerData.shared);
const inputs = inputView(workerData.shared);
const adc = adcView(workerData.shared);
const rx = rxView(workerData.shared);

const pinModes = new Array(64).fill(0);
const pinPulls = new Array(64).fill(0);
const pinOutputs = new Array(64).fill(0);
const post = (message) => parentPort.postMessage(message);

const parts = (workerData.partsModule ? require(workerData.partsModule) : () => [])(workerData.partsConfig);
const i2cDevices = new Map();
for (const part of parts) {
  if (part.i2cAddress !== undefined) i2cDevices.set(part.i2cAddress, part);
}

const notifyParts = (method, ...args) => {
  for (const part of parts) part[method]?.(...args);
};

const sim = {
  files: workerData.files,
  portHeapBytes: workerData.portHeapBytes,

  serialWrite: (data) => post({ type: 'serial', data }),
  serialAvailable: () => (Atomics.load(ctrl, CTRL.RX_HEAD) - Atomics.load(ctrl, CTRL.RX_TAIL) + rx.length) % rx.length,
  serialPeek() {
    return sim.serialAvailable() === 0 ? -1 : rx[Atomics.load(ctrl, CTRL.RX_TAIL)];
  },
  serialRead() {
    if (sim.serialAvailable() === 0) return -1;
    const tail = Atomics.load(ctrl, CTRL.RX_TAIL);
    const value = rx[tail];
    Atomics.store(ctrl, CTRL.RX_TAIL, (tail + 1) % rx.length);
    return value;
  },

  waitMs: (ms) => Atomics.wait(ctrl, CTRL.WAKE, Atomics.load(ctrl, CTRL.WAKE), ms),
  reset(toBootloader) {
    post({ type: 'reset', toBootloader: !!toBootloader });
    Atomics.wait(ctrl, CTRL.PARKED, 0);
  },

  pinMode(pin, mode, pull, openDrain) {
    pinModes[pin] = mode;
    pinPulls[pin] = pull;
    post({ type: 'pinMode', pin, mode, pull, openDrain: !!openDrain });
    notifyParts('onPinMode', pin, mode, pull);
  },
  pinWrite(pin, value) {
    pinOutputs[pin] = value;
    post({ type: 'pin', pin, value, at: performance.now() });
    notifyParts('onPinWrite', pin, value);
  },
  pinRead(pin) {
    const external = Atomics.load(inputs, pin);
    if (external >= 0) return external;
    return pinPulls[pin] === 1 ? 1 : 0;
  },
  adcRead: (pin) => Atomics.load(adc, pin),
  dacWrite: (pin, value) => post({ type: 'dac', pin, value }),
  pwmSet(pin, frequency, duty) {
    post({ type: 'pwm', pin, frequency, duty });
    notifyParts('onPwm', pin, frequency, duty);
  },
  neopixelWrite: (pin, data) => post({ type: 'neopixel', pin, data }),

  i2cPullups: () => (workerData.i2cPullups === false ? 0 : 1),
  i2cProbe: (address) => (i2cDevices.has(address) ? 1 : 0),
  i2cWrite(address, data) {
    const device = i2cDevices.get(address);
    if (!device) return 19; // ENODEV, as a missing device reports on the real board.
    device.i2cWrite(data);
    return 0;
  },
  i2cRead(address, buffer) {
    const device = i2cDevices.get(address);
    if (!device) return 19;
    device.i2cRead(buffer);
    return 0;
  },
  spiTransfer: (clock, data) => data,
  uartWrite: (tx, data) => post({ type: 'uart', tx, data }),
  uartAvailable: () => 0,
  uartRead: () => -1,
};

const createCircuitPython = require(path.resolve(workerData.firmware));
createCircuitPython({
  sim,
  print: (text) => post({ type: 'log', text }),
  printErr: (text) => post({ type: 'log', text }),
}).catch((error) => post({ type: 'crash', message: String(error?.stack ?? error) }));
