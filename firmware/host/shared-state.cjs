// Layout of the memory shared between the host and the engine worker.
const CTRL = { WAKE: 0, RX_HEAD: 1, RX_TAIL: 2, PARKED: 3, EVENT_HEAD: 4, EVENT_TAIL: 5 };
const CTRL_WORDS = 8;
const PIN_COUNT = 64;
const RX_BYTES = 4096;

// Stimulus sent to the worker, as [kind, a, b] triples in a ring.
const EVENT = { PULSE: 1, UART: 2, ENCODER: 3, CDC: 4, MIDI: 5 };
const EVENT_WORDS = 3 * 8192;

const INPUT_OFFSET = CTRL_WORDS * 4;
const ADC_OFFSET = INPUT_OFFSET + PIN_COUNT * 4;
const TOUCH_OFFSET = ADC_OFFSET + PIN_COUNT * 4;
const EVENT_OFFSET = TOUCH_OFFSET + PIN_COUNT * 4;
const RX_OFFSET = EVENT_OFFSET + EVENT_WORDS * 4;

function createShared() {
  const shared = new SharedArrayBuffer(RX_OFFSET + RX_BYTES);
  inputView(shared).fill(-1); // -1 means nothing is driving the pin.
  return shared;
}

const ctrlView = (shared) => new Int32Array(shared, 0, CTRL_WORDS);
const inputView = (shared) => new Int32Array(shared, INPUT_OFFSET, PIN_COUNT);
const adcView = (shared) => new Int32Array(shared, ADC_OFFSET, PIN_COUNT);
const touchView = (shared) => new Int32Array(shared, TOUCH_OFFSET, PIN_COUNT);
const eventView = (shared) => new Int32Array(shared, EVENT_OFFSET, EVENT_WORDS);
const rxView = (shared) => new Uint8Array(shared, RX_OFFSET, RX_BYTES);

module.exports = {
  CTRL, EVENT, createShared, ctrlView, inputView, adcView, touchView, eventView, rxView,
};
