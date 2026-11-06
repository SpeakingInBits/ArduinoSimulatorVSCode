// Runs CircuitPython in a worker thread. The thread blocks inside WebAssembly, so it can
// never receive messages: everything the outside world changes arrives through shared memory.
const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const {
  CTRL, EVENT, ctrlView, inputView, adcView, touchView, eventView, rxView,
} = require('./shared-state.cjs');

const ctrl = ctrlView(workerData.shared);
const inputs = inputView(workerData.shared);
const adc = adcView(workerData.shared);
const touch = touchView(workerData.shared);
const events = eventView(workerData.shared);
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

// A real RTC starts at 2000-01-01 on power up, because the board has no battery.
const RTC_POWER_ON_SECONDS = 946684800;
let rtcOffset = (workerData.rtcStart ?? RTC_POWER_ON_SECONDS) - performance.now() / 1000;

// Flash that has been erased reads as all ones.
const nvm = new Uint8Array(256).fill(0xff);
if (workerData.nvm) nvm.set(workerData.nvm);

let nextHandle = 1;
const encoders = new Map();
const pulseIns = new Map();
const uartQueues = new Map();
const cdcQueue = [];
const midiQueue = [];

// Applies stimulus from the host. Runs whenever the firmware asks about an input that uses it.
function drainEvents() {
  let tail = Atomics.load(ctrl, CTRL.EVENT_TAIL);
  const head = Atomics.load(ctrl, CTRL.EVENT_HEAD);
  while (tail !== head) {
    const [kind, a, b] = events.subarray(tail, tail + 3);
    tail = (tail + 3) % events.length;
    if (kind === EVENT.PULSE) {
      for (const input of pulseIns.values()) {
        if (input.pin === a && !input.paused) input.queue.push(b);
      }
    } else if (kind === EVENT.UART) {
      if (!uartQueues.has(a)) uartQueues.set(a, []);
      uartQueues.get(a).push(b);
    } else if (kind === EVENT.ENCODER) {
      for (const encoder of encoders.values()) {
        if (encoder.pinA === a) encoder.count += b;
      }
    } else if (kind === EVENT.CDC) {
      cdcQueue.push(a);
    } else if (kind === EVENT.MIDI) {
      midiQueue.push(a);
    }
  }
  Atomics.store(ctrl, CTRL.EVENT_TAIL, tail);
}

let pdmSamples = 0;

// Plays nothing, but holds a queue that drains in real time, which is what the firmware paces against.
function audioOutput(prefix, event) {
  let rate = 0;
  let channels = 1;
  let queuedUntil = 0; // When the queue runs out, in performance.now() time.
  let pausedMs = null; // How much was queued when paused.
  const queuedMs = () => Math.max(0, queuedUntil - performance.now());
  return {
    [`${prefix}Start`](pin, sampleRate, channelCount) {
      rate = sampleRate;
      channels = channelCount;
      queuedUntil = 0;
      pausedMs = null;
      post({ type: `${event}Start`, pin, sampleRate, channels: channelCount });
    },
    [`${prefix}Write`](samples) {
      const lengthMs = (samples.length / channels / rate) * 1000;
      if (pausedMs !== null) pausedMs += lengthMs;
      else queuedUntil = Math.max(queuedUntil, performance.now()) + lengthMs;
      post({ type: `${event}Write`, samples });
    },
    [`${prefix}Stop`](pin) {
      queuedUntil = 0;
      pausedMs = null;
      post({ type: `${event}Stop`, pin });
    },
    [`${prefix}Pause`](pin, paused) {
      if (paused) {
        pausedMs = queuedMs();
      } else {
        queuedUntil = performance.now() + pausedMs;
        pausedMs = null;
      }
      post({ type: `${event}Pause`, pin, paused });
    },
    [`${prefix}BufferedMs`]: () => Math.ceil(pausedMs ?? queuedMs()),
  };
}

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
  delayUs: (us) => notifyParts('onDelay', us),
  reset(toBootloader) {
    post({ type: 'reset', toBootloader: !!toBootloader });
    Atomics.wait(ctrl, CTRL.PARKED, 0);
  },

  pinMode(pin, mode, pull, openDrain) {
    pinModes[pin] = mode;
    pinPulls[pin] = pull;
    // Parts come first: posting takes long enough to distort microsecond timing.
    notifyParts('onPinMode', pin, mode, pull);
    post({ type: 'pinMode', pin, mode, pull, openDrain: !!openDrain });
  },
  pinWrite(pin, value) {
    pinOutputs[pin] = value;
    post({ type: 'pin', pin, value, at: performance.now() });
    notifyParts('onPinWrite', pin, value);
  },
  pinRead(pin) {
    for (const part of parts) {
      const level = part.onPinRead?.(pin);
      if (level !== undefined) return level;
    }
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
  spiTransfer(clock, data) {
    for (const part of parts) {
      if (part.onSpi) return part.onSpi(clock, data);
    }
    return data;
  },
  parallelWrite(data0, data) {
    notifyParts('onParallel', data0, data);
  },
  uartWrite: (tx, data) => post({ type: 'uart', tx, data }),
  uartAvailable(rxPin) {
    drainEvents();
    return uartQueues.get(rxPin)?.length ?? 0;
  },
  uartRead(rxPin) {
    return uartQueues.get(rxPin)?.shift() ?? -1;
  },

  touchRead: (pin) => Atomics.load(touch, pin),

  rtcGet: () => rtcOffset + performance.now() / 1000,
  rtcSet(seconds) {
    rtcOffset = seconds - performance.now() / 1000;
    post({ type: 'rtcSet', seconds });
  },

  nvmRead: (offset, length) => nvm.slice(offset, offset + length),
  nvmWrite(offset, data) {
    nvm.set(data, offset);
    post({ type: 'nvmWrite', offset, data });
  },

  encoderOpen(pinA, pinB) {
    const id = nextHandle++;
    encoders.set(id, { pinA, pinB, count: 0 });
    post({ type: 'encoderOpen', id, pinA, pinB });
    return id;
  },
  encoderRead(id) {
    drainEvents();
    return encoders.get(id).count;
  },
  encoderWrite(id, count) {
    encoders.get(id).count = count;
  },
  encoderClose(id) {
    encoders.delete(id);
    post({ type: 'encoderClose', id });
  },

  // Capture runs from the moment of opening, as the real PulseIn does.
  pulseinOpen(pin, idleState) {
    const id = nextHandle++;
    pulseIns.set(id, { pin, idleState, queue: [], paused: false });
    post({ type: 'pulseinOpen', id, pin, idleState: !!idleState });
    return id;
  },
  pulseinResume(id, triggerMicros) {
    drainEvents();
    pulseIns.get(id).paused = false;
    post({ type: 'pulseinResume', id, triggerMicros });
  },
  pulseinPause(id) {
    drainEvents();
    pulseIns.get(id).paused = true;
  },
  pulseinClear(id) {
    drainEvents();
    pulseIns.get(id).queue.length = 0;
  },
  pulseinCount(id) {
    drainEvents();
    return pulseIns.get(id).queue.length;
  },
  pulseinPop(id) {
    return pulseIns.get(id).queue.shift() ?? -1;
  },
  pulseinClose(id) {
    pulseIns.delete(id);
    post({ type: 'pulseinClose', id });
  },
  pulseoutSend(pin, frequency, dutyCycle, pulses) {
    post({ type: 'pulseout', pin, frequency, dutyCycle, pulses, at: performance.now() });
  },

  cdcWrite: (data) => post({ type: 'cdc', data }),
  cdcAvailable() {
    drainEvents();
    return cdcQueue.length;
  },
  cdcRead: () => cdcQueue.shift() ?? -1,
  hidSend: (reportId, report) => post({ type: 'hid', reportId, report }),
  midiWrite: (data) => post({ type: 'midi', data }),
  midiAvailable() {
    drainEvents();
    return midiQueue.length;
  },
  midiRead: () => midiQueue.shift() ?? -1,

  ...audioOutput('audio', 'audio'),
  ...audioOutput('i2s', 'i2s'),

  // A steady tone, so that a recording has something to show.
  pdmRead(sampleCount, sampleRate) {
    const samples = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = Math.round(10000 * Math.sin((2 * Math.PI * 440 * pdmSamples++) / sampleRate));
    }
    return samples;
  },
};

const createCircuitPython = require(path.resolve(workerData.firmware));
createCircuitPython({
  sim,
  print: (text) => post({ type: 'log', text }),
  printErr: (text) => post({ type: 'log', text }),
}).catch((error) => post({ type: 'crash', message: String(error?.stack ?? error) }));
