// Memory shared between the host and the engine worker. The worker spends its time blocked
// inside WebAssembly, so this is the only way to reach it while a program runs.
export const CTRL = { WAKE: 0, RX_HEAD: 1, RX_TAIL: 2, PARKED: 3, CONTROLS_CHANGED: 4 };

const CTRL_WORDS = 8;
const RX_BYTES = 4096;
const RX_OFFSET = CTRL_WORDS * 4;
const CONTROLS_OFFSET = RX_OFFSET + RX_BYTES;

export function createShared(controlCount) {
  return new SharedArrayBuffer(CONTROLS_OFFSET + Math.max(1, controlCount) * 8);
}

export const ctrlView = (shared) => new Int32Array(shared, 0, CTRL_WORDS);
export const rxView = (shared) => new Uint8Array(shared, RX_OFFSET, RX_BYTES);
export const controlsView = (shared) => new Float64Array(shared, CONTROLS_OFFSET);
