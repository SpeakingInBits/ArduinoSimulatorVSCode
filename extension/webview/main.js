// The circuit builder: place parts, draw wires, and show the running simulation.
import { BOARD_TYPE, CATALOG, CATEGORIES, defaultProps, definition, emptyCircuit, pinPosition } from '../shared/catalog.js';
import { buildNets, pinKey } from '../shared/nets.js';
import { holePattern, partArt } from './art.js';

const vscode = acquireVsCodeApi();
const GRID = 10;
const PIN_HIT = 6;
const NS = 'http://www.w3.org/2000/svg';
const WIRE_COLORS = ['#2e9e4f', '#2f7bff', '#ff9f0a', '#b45cff', '#e0c400', '#19b5c9', '#d33', '#222', '#eee'];
const POWER_PIN = /^(3V|5V|VIN|VCC|V\+|\+|\+5V|VDD|VS|5V)$/;
const GROUND_PIN = /^(GND\d?|VSS|-)$/;

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const world = $('world');

const state = {
  doc: emptyCircuit(),
  selection: null, // { kind: 'part' | 'wire', id }
  running: false,
  views: {},
  board: {},
  problems: [],
  undo: [],
  redo: [],
  zoom: 1.6,
  pan: { x: 20, y: 20 },
  wiring: null, // { from, points, color }
  drag: null,
  panning: null,
  held: new Set(),
  colorIndex: 0,
  controlValues: {},
  loadError: undefined, // Why circuit.json could not be used. Nothing can be edited until it is fixed.
};

const partById = (id) => state.doc.parts.find((part) => part.id === id);
const locked = () => state.running || !!state.loadError;
const snap = (value) => Math.round(value / GRID) * GRID;

function nextId(prefix) {
  const taken = new Set([...state.doc.parts.map((p) => p.id), ...state.doc.wires.map((w) => w.id)]);
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

// --- History and saving ---

function snapshot() {
  state.undo.push(JSON.stringify(state.doc));
  if (state.undo.length > 100) state.undo.shift();
  state.redo = [];
  updateToolbar();
}

function changed() {
  vscode.postMessage({ type: 'save', circuit: state.doc });
  render();
}

function restore(from, to) {
  if (from.length === 0 || locked()) return;
  to.push(JSON.stringify(state.doc));
  state.doc = JSON.parse(from.pop());
  state.selection = null;
  changed();
}

// --- Coordinates ---

function toWorld(event) {
  const box = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - box.left - state.pan.x) / state.zoom,
    y: (event.clientY - box.top - state.pan.y) / state.zoom,
  };
}

function applyTransform() {
  world.setAttribute('transform', `translate(${state.pan.x} ${state.pan.y}) scale(${state.zoom})`);
}

function bounds(part) {
  const entry = definition(part.type);
  const xs = [];
  const ys = [];
  for (const [x, y] of [[-6, -14], [entry.w + 6, -14], [-6, entry.h + 8], [entry.w + 6, entry.h + 8]]) {
    const p = pinPosition(part, { x, y });
    xs.push(p.x);
    ys.push(p.y);
  }
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function fit() {
  const boxes = state.doc.parts.map(bounds);
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const box = canvas.getBoundingClientRect();
  state.zoom = Math.max(0.3, Math.min(3, Math.min((box.width - 40) / (right - left), (box.height - 40) / (bottom - top))));
  state.pan = {
    x: (box.width - (right - left) * state.zoom) / 2 - left * state.zoom,
    y: (box.height - (bottom - top) * state.zoom) / 2 - top * state.zoom,
  };
  applyTransform();
}

// Finds the pin under a point. Parts win over the breadboard holes they sit in.
function pinAt(point) {
  let best = null;
  for (const part of state.doc.parts) {
    const entry = definition(part.type);
    for (const pinDef of entry.pins) {
      const position = pinPosition(part, pinDef);
      const distance = Math.hypot(position.x - point.x, position.y - point.y);
      if (distance > PIN_HIT) continue;
      const score = distance + (entry.background ? PIN_HIT : 0);
      if (!best || score < best.score) best = { score, part, pin: pinDef, position };
    }
  }
  return best;
}

function pinEnd(end) {
  const part = partById(end.part);
  const pinDef = part && definition(part.type).pins.find((p) => p.id === end.pin);
  return pinDef ? pinPosition(part, pinDef) : null;
}

// --- Rendering ---

function partGroup(part) {
  const entry = definition(part.type);
  const interactive = (entry.controls ?? []).some((control) => ['momentary', 'toggle'].includes(control.kind));
  const view = part.type === BOARD_TYPE ? { board: state.board } : state.views[part.id];
  return `<g class="part${interactive ? ' interactive' : ''}" data-part="${part.id}" transform="translate(${part.x} ${part.y}) rotate(${part.rotation ?? 0})">${partArt(part, view)}</g>`;
}

function wirePath(wire) {
  const start = pinEnd(wire.from);
  const end = pinEnd(wire.to);
  if (!start || !end) return null;
  return [start, ...(wire.points ?? []), end].map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
}

function renderWires() {
  let html = '';
  for (const wire of state.doc.wires) {
    const d = wirePath(wire);
    if (!d) continue;
    const selected = state.selection?.kind === 'wire' && state.selection.id === wire.id;
    html += `<path class="wire${selected ? ' selected' : ''}" d="${d}" stroke="${wire.color}"/><path class="wire-hit" data-wire="${wire.id}" d="${d}"/>`;
  }
  $('layer-wires').innerHTML = html;
}

function renderOverlay(pointer) {
  let html = '';
  if (state.selection?.kind === 'part') {
    const part = partById(state.selection.id);
    if (part) {
      const box = bounds(part);
      html += `<rect class="selected-outline" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/>`;
    }
  }
  if (state.wiring) {
    const start = pinEnd(state.wiring.from);
    const points = [start, ...state.wiring.points, pointer ?? state.wiring.pointer ?? start];
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
    html += `<path class="wire preview" d="${d}" stroke="${state.wiring.color}"/>`;
  }
  if (state.hoverPin) {
    const { x, y } = state.hoverPin.position;
    html += `<circle class="pin-mark" cx="${x}" cy="${y}" r="2.6"/>`;
    for (const mark of state.hoverNet ?? []) html += `<circle class="net-mark" cx="${mark.x}" cy="${mark.y}" r="3.2"/>`;
  }
  $('layer-overlay').innerHTML = html;
}

function render() {
  const background = [];
  const front = [];
  for (const part of state.doc.parts) (definition(part.type).background ? background : front).push(partGroup(part));
  $('layer-background').innerHTML = background.join('');
  $('layer-parts').innerHTML = front.join('');
  renderWires();
  renderOverlay();
  renderInspector();
  updateToolbar();
}

function updatePart(id) {
  const part = partById(id);
  const element = canvas.querySelector(`[data-part="${id}"]`);
  if (!part || !element) return;
  const view = part.type === BOARD_TYPE ? { board: state.board } : state.views[id];
  element.innerHTML = partArt(part, view);
}

function updateToolbar() {
  $('undo').disabled = locked() || state.undo.length === 0;
  $('redo').disabled = locked() || state.redo.length === 0;
  const selected = !!state.selection && !locked();
  const fixed = state.selection?.kind === 'part' && definition(partById(state.selection.id)?.type ?? 'resistor').fixed;
  $('rotate').disabled = !selected || state.selection.kind !== 'part' || fixed;
  $('delete').disabled = !selected || fixed;
  $('run').textContent = state.running ? 'Restart' : 'Run';
  $('run').disabled = !!state.loadError;
  $('stop').disabled = !state.running;
  document.body.classList.toggle('running', state.running);
}

// --- Palette ---

function renderPalette(filter = '') {
  const query = filter.trim().toLowerCase();
  let html = '';
  for (const category of CATEGORIES) {
    const items = Object.entries(CATALOG).filter(([, entry]) => entry.category === category && !entry.fixed
      && (entry.name.toLowerCase().includes(query) || category.toLowerCase().includes(query)));
    if (items.length === 0) continue;
    html += `<div class="category">${category}</div>`;
    for (const [type, entry] of items) {
      html += `<button class="part-button" data-add="${type}" title="${entry.description ?? entry.name}">${entry.name}</button>`;
    }
  }
  $('parts').innerHTML = html || '<p class="empty">No parts match.</p>';
}

function addPart(type) {
  if (locked()) return;
  const box = canvas.getBoundingClientRect();
  const entry = definition(type);
  const count = state.doc.parts.length;
  snapshot();
  const part = {
    id: nextId(type.replace(/[^a-z]/g, '')),
    type,
    x: snap((box.width / 2 - state.pan.x) / state.zoom - entry.w / 2 + (count % 5) * 20),
    y: snap((box.height / 2 - state.pan.y) / state.zoom - entry.h / 2 + (count % 5) * 20),
    rotation: 0,
    props: defaultProps(type),
  };
  state.doc.parts.push(part);
  state.selection = { kind: 'part', id: part.id };
  changed();
}

// --- Editing ---

function deleteSelection() {
  const { selection } = state;
  if (!selection || locked()) return;
  if (selection.kind === 'part') {
    const part = partById(selection.id);
    if (!part || definition(part.type).fixed) return;
    snapshot();
    state.doc.parts = state.doc.parts.filter((p) => p !== part);
    state.doc.wires = state.doc.wires.filter((w) => w.from.part !== part.id && w.to.part !== part.id);
  } else {
    snapshot();
    state.doc.wires = state.doc.wires.filter((w) => w.id !== selection.id);
  }
  state.selection = null;
  changed();
}

function rotateSelection() {
  if (state.selection?.kind !== 'part' || locked()) return;
  const part = partById(state.selection.id);
  if (!part || definition(part.type).fixed) return;
  snapshot();
  part.rotation = ((part.rotation ?? 0) + 90) % 360;
  changed();
}

function duplicateSelection() {
  if (state.selection?.kind !== 'part' || locked()) return;
  const part = partById(state.selection.id);
  if (!part || definition(part.type).fixed) return;
  snapshot();
  const copy = { ...JSON.parse(JSON.stringify(part)), id: nextId(part.type.replace(/[^a-z]/g, '')), x: part.x + 20, y: part.y + 20 };
  state.doc.parts.push(copy);
  state.selection = { kind: 'part', id: copy.id };
  changed();
}

function wireColor(pinId) {
  if (GROUND_PIN.test(pinId)) return '#222';
  if (POWER_PIN.test(pinId)) return '#d33';
  const color = WIRE_COLORS[state.colorIndex % 6];
  state.colorIndex++;
  return color;
}

function finishWire(target) {
  const { from, points, color } = state.wiring;
  if (from.part === target.part.id && from.pin === target.pin.id) {
    state.wiring = null;
    renderOverlay();
    return;
  }
  snapshot();
  const wire = { id: nextId('wire'), from, to: { part: target.part.id, pin: target.pin.id }, points, color };
  state.doc.wires.push(wire);
  state.wiring = null;
  state.selection = { kind: 'wire', id: wire.id };
  changed();
}

function setHover(hit, event) {
  const key = hit ? pinKey(hit.part.id, hit.pin.id) : null;
  if (key !== state.hoverKey) {
    state.hoverKey = key;
    state.hoverPin = hit;
    state.hoverNet = hit ? connectedPins(key) : null;
  }
  const tooltip = $('tooltip');
  tooltip.hidden = !hit;
  if (hit) {
    const entry = definition(hit.part.type);
    tooltip.textContent = `${entry.name}: ${hit.pin.label}`;
    const box = canvas.getBoundingClientRect();
    tooltip.style.left = `${event.clientX - box.left + 12}px`;
    tooltip.style.top = `${event.clientY - box.top + 12}px`;
  }
}

// Marks everything joined to a pin, which makes breadboard rows easy to understand.
function connectedPins(key) {
  const nets = buildNets(state.doc);
  const root = nets.find(key);
  const marks = [];
  for (const part of state.doc.parts) {
    for (const pinDef of definition(part.type).pins) {
      if (nets.find(pinKey(part.id, pinDef.id)) === root) marks.push(pinPosition(part, pinDef));
    }
  }
  return marks.length > 1 ? marks : [];
}

// --- Pointer handling ---

function controlOf(part, kinds) {
  return (definition(part.type).controls ?? []).find((control) => kinds.includes(control.kind));
}

function sendControl(partId, control, value) {
  state.controlValues[`${partId}:${control}`] = value;
  vscode.postMessage({ type: 'control', part: partId, control, value });
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.focus();
  canvas.setPointerCapture(event.pointerId);
  const point = toWorld(event);
  const partElement = event.target.closest?.('[data-part]');
  const wireElement = event.target.closest?.('[data-wire]');

  if (event.button === 1 || (event.button === 0 && event.altKey)) {
    state.panning = { x: event.clientX - state.pan.x, y: event.clientY - state.pan.y };
    return;
  }

  if (state.running) {
    if (partElement) {
      const part = partById(partElement.dataset.part);
      state.selection = { kind: 'part', id: part.id };
      const hold = controlOf(part, ['momentary']);
      const toggle = controlOf(part, ['toggle']);
      if (hold) {
        sendControl(part.id, hold.id, 1);
        state.held.add(`${part.id}:${hold.id}`);
      } else if (toggle) {
        const key = `${part.id}:${toggle.id}`;
        sendControl(part.id, toggle.id, state.controlValues[key] ? 0 : 1);
        renderControls();
      }
      renderOverlay();
    } else {
      state.panning = { x: event.clientX - state.pan.x, y: event.clientY - state.pan.y };
    }
    return;
  }

  if (state.loadError) {
    state.panning = { x: event.clientX - state.pan.x, y: event.clientY - state.pan.y };
    return;
  }

  const hit = pinAt(point);
  if (state.wiring) {
    if (hit) {
      finishWire(hit);
    } else {
      state.wiring.points.push({ x: snap(point.x), y: snap(point.y) });
      renderOverlay(point);
    }
    return;
  }
  // A click on a part's body should grab the part, even over the breadboard hole beneath it.
  const overPart = partElement && !definition(partById(partElement.dataset.part).type).background;
  if (hit && !(overPart && definition(hit.part.type).background)) {
    state.wiring = { from: { part: hit.part.id, pin: hit.pin.id }, points: [], color: wireColor(hit.pin.id) };
    state.selection = null;
    renderInspector();
    updateToolbar();
    renderOverlay(point);
    return;
  }
  if (wireElement) {
    state.selection = { kind: 'wire', id: wireElement.dataset.wire };
    renderWires();
    renderOverlay();
    renderInspector();
    updateToolbar();
    return;
  }
  if (partElement) {
    const part = partById(partElement.dataset.part);
    state.selection = { kind: 'part', id: part.id };
    renderInspector();
    updateToolbar();
    renderOverlay();
    state.drag = { part, dx: point.x - part.x, dy: point.y - part.y, moved: false, before: JSON.stringify(state.doc) };
    return;
  }
  state.selection = null;
  renderWires();
  renderOverlay();
  renderInspector();
  updateToolbar();
  state.panning = { x: event.clientX - state.pan.x, y: event.clientY - state.pan.y };
});

canvas.addEventListener('pointermove', (event) => {
  const point = toWorld(event);
  if (state.panning) {
    state.pan = { x: event.clientX - state.panning.x, y: event.clientY - state.panning.y };
    applyTransform();
    return;
  }
  if (state.drag) {
    const { part, dx, dy } = state.drag;
    const x = snap(point.x - dx);
    const y = snap(point.y - dy);
    if (x !== part.x || y !== part.y) {
      part.x = x;
      part.y = y;
      state.drag.moved = true;
      canvas.querySelector(`[data-part="${part.id}"]`)?.setAttribute('transform', `translate(${x} ${y}) rotate(${part.rotation ?? 0})`);
      renderWires();
      renderOverlay();
    }
    return;
  }
  setHover(state.running ? null : pinAt(point), event);
  if (state.wiring) state.wiring.pointer = point;
  renderOverlay(point);
});

function endPointer() {
  if (state.drag?.moved) {
    state.undo.push(state.drag.before);
    state.redo = [];
    vscode.postMessage({ type: 'save', circuit: state.doc });
    render();
  }
  state.drag = null;
  state.panning = null;
  for (const key of state.held) {
    const [part, control] = key.split(':');
    sendControl(part, control, 0);
  }
  state.held.clear();
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const box = canvas.getBoundingClientRect();
  const x = event.clientX - box.left;
  const y = event.clientY - box.top;
  const factor = Math.exp(-event.deltaY * 0.0015);
  const zoom = Math.max(0.25, Math.min(5, state.zoom * factor));
  state.pan.x = x - ((x - state.pan.x) / state.zoom) * zoom;
  state.pan.y = y - ((y - state.pan.y) / state.zoom) * zoom;
  state.zoom = zoom;
  applyTransform();
}, { passive: false });

window.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || event.target.id === 'console';
  if (typing) return;
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === 'Escape') {
    state.wiring = null;
    renderOverlay();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    deleteSelection();
  } else if (event.key.toLowerCase() === 'r' && !mod) {
    rotateSelection();
  } else if (mod && event.key.toLowerCase() === 'z') {
    restore(state.undo, state.redo);
  } else if (mod && event.key.toLowerCase() === 'y') {
    restore(state.redo, state.undo);
  } else if (mod && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    duplicateSelection();
  } else {
    return;
  }
  event.preventDefault();
});

// --- Inspector ---

function field(label, control) {
  return `<label class="field"><span>${label}</span>${control}</label>`;
}

function formatChoice(value, unit) {
  if (unit === 'ohm') return value >= 1e6 ? `${value / 1e6}M ohm` : value >= 1000 ? `${value / 1000}k ohm` : `${value} ohm`;
  return unit ? `${value} ${unit}` : `${value}`;
}

function renderInspector() {
  const { selection } = state;
  let html = '';
  if (state.loadError) {
    html += `<h2>circuit.json needs fixing</h2><p>${state.loadError.replace(/</g, '&lt;')}</p><p>Your file has not been changed. Fix it and save it, and the circuit will load.</p>`;
  } else if (selection?.kind === 'part') {
    const part = partById(selection.id);
    if (part) {
      const entry = definition(part.type);
      html += `<h2>${entry.name}</h2><p>${entry.description ?? ''}</p>`;
      for (const [key, spec] of Object.entries(entry.props ?? {})) {
        const options = spec.choices.map((choice) => `<option value="${choice}" ${String(part.props?.[key]) === String(choice) ? 'selected' : ''}>${formatChoice(choice, spec.unit)}</option>`).join('');
        html += field(spec.label, `<select data-prop="${key}" ${state.running ? 'disabled' : ''}>${options}</select>`);
      }
    }
  } else if (selection?.kind === 'wire') {
    const wire = state.doc.wires.find((w) => w.id === selection.id);
    if (wire) {
      html += '<h2>Wire</h2>';
      html += `<div class="swatches" role="group" aria-label="Wire color">${WIRE_COLORS.map((color) => `<button class="swatch" data-color="${color}" aria-label="${color}" aria-pressed="${wire.color === color}" style="background:${color}"></button>`).join('')}</div>`;
    }
  } else {
    html += state.running
      ? '<h2>Running</h2><p>Use the controls below, or press parts on the canvas.</p>'
      : '<h2>Build your circuit</h2><p>Add parts from the list. Click a pin to start a wire, click empty space to add a bend, and click another pin to finish. Press R to rotate.</p>';
  }
  $('details').innerHTML = html;
  renderControls();
}

function renderControls() {
  if (!state.running) {
    $('controls').innerHTML = '';
    return;
  }
  let html = '';
  for (const part of state.doc.parts) {
    const controls = definition(part.type).controls ?? [];
    if (controls.length === 0) continue;
    html += `<div class="control-part"><h3>${definition(part.type).name} <span class="status">${part.id}</span></h3>`;
    for (const control of controls) {
      const key = `${part.id}:${control.id}`;
      const value = state.controlValues[key] ?? control.default ?? 0;
      if (control.kind === 'slider') {
        const unit = control.unit ? ` ${control.unit}` : '';
        html += field(`${control.label}: <output data-readout="${key}">${value}${unit}</output>`, `<input type="range" data-slider="${key}" data-unit="${unit}" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}">`);
      } else if (control.kind === 'momentary') {
        html += `<button data-hold="${key}">${control.label}</button> `;
      } else if (control.kind === 'toggle') {
        html += `<button data-toggle="${key}" aria-pressed="${!!value}">${control.label}: ${value ? 'on' : 'off'}</button> `;
      } else if (control.kind === 'stepper') {
        html += `<button data-step="${key}" data-delta="-1">Left</button> <button data-step="${key}" data-delta="1">Right</button> `;
      } else if (control.kind === 'keys') {
        html += `<div class="keys">${[...control.keys].map((label, i) => `<button data-key="${key}" data-value="${i + 1}">${label}</button>`).join('')}</div>`;
      }
    }
    html += '</div>';
  }
  $('controls').innerHTML = html;
}

$('details').addEventListener('change', (event) => {
  const key = event.target.dataset.prop;
  if (!key || state.selection?.kind !== 'part') return;
  const part = partById(state.selection.id);
  snapshot();
  const raw = event.target.value;
  part.props[key] = Number.isNaN(Number(raw)) ? raw : Number(raw);
  changed();
});

$('details').addEventListener('click', (event) => {
  const color = event.target.dataset?.color;
  if (!color || state.selection?.kind !== 'wire') return;
  snapshot();
  state.doc.wires.find((w) => w.id === state.selection.id).color = color;
  changed();
});

const splitKey = (key) => key.split(':');

$('controls').addEventListener('input', (event) => {
  const key = event.target.dataset.slider;
  if (!key) return;
  const [part, control] = splitKey(key);
  const value = Number(event.target.value);
  sendControl(part, control, value);
  const readout = $('controls').querySelector(`[data-readout="${key}"]`);
  if (readout) readout.textContent = `${value}${event.target.dataset.unit}`;
});

$('controls').addEventListener('pointerdown', (event) => {
  const hold = event.target.dataset.hold ?? event.target.dataset.key;
  if (!hold) return;
  const [part, control] = splitKey(hold);
  sendControl(part, control, Number(event.target.dataset.value ?? 1));
  const release = () => {
    sendControl(part, control, 0);
    window.removeEventListener('pointerup', release);
  };
  window.addEventListener('pointerup', release);
});

$('controls').addEventListener('click', (event) => {
  const toggle = event.target.dataset.toggle;
  const step = event.target.dataset.step;
  if (toggle) {
    const [part, control] = splitKey(toggle);
    sendControl(part, control, state.controlValues[toggle] ? 0 : 1);
    renderControls();
  } else if (step) {
    const [part, control] = splitKey(step);
    sendControl(part, control, (state.controlValues[step] ?? 0) + Number(event.target.dataset.delta));
  }
});

// --- Serial console ---

const consoleElement = $('console');
let partialSerial = '';

// The end of an escape sequence that has not finished arriving. The length limit stops a stray
// escape character from holding back everything printed after it.
const UNFINISHED_ESCAPE = /\x1b(?:\][^\x1b]{0,200}\x1b?|\[[0-9;]{0,20})?$/;

function appendSerial(chunk) {
  // An escape sequence can arrive split across batches, so hold back an unfinished one.
  let text = partialSerial + chunk;
  const unfinished = text.match(UNFINISHED_ESCAPE);
  partialSerial = unfinished ? unfinished[0] : '';
  if (unfinished) text = text.slice(0, unfinished.index);
  const title = [...text.matchAll(/\x1b\]0;(.*?)\x1b\\/g)].at(-1);
  if (title) $('board-title').textContent = title[1];
  const clean = text.replace(/\x1b\].*?\x1b\\/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
  let content = consoleElement.textContent;
  for (const character of clean) {
    if (character === '\b') content = content.slice(0, -1);
    else content += character;
  }
  consoleElement.textContent = content.slice(-60000);
  consoleElement.scrollTop = consoleElement.scrollHeight;
}

consoleElement.addEventListener('keydown', (event) => {
  let text = event.key.length === 1 ? event.key : { Enter: '\r', Backspace: '\b', Tab: '\t' }[event.key];
  if (event.ctrlKey && event.key.toLowerCase() === 'c') text = '\x03';
  if (event.ctrlKey && event.key.toLowerCase() === 'd') text = '\x04';
  if (text) {
    vscode.postMessage({ type: 'input', text });
    event.preventDefault();
  }
});

function showTab(name) {
  const onConsole = name === 'console';
  consoleElement.hidden = !onConsole;
  $('problems').hidden = onConsole;
  $('tab-console').classList.toggle('active', onConsole);
  $('tab-problems').classList.toggle('active', !onConsole);
}

function renderProblems() {
  const errors = state.problems.length;
  $('problem-count').textContent = errors ? `(${errors})` : '';
  $('problems').innerHTML = errors
    ? state.problems.map((p) => `<div class="problem ${p.severity}"><span class="tag">${p.severity}</span><span>${p.message.replace(/</g, '&lt;')}</span></div>`).join('')
    : '<p class="empty">No problems found.</p>';
}

// --- Sound ---

let audio;
const tones = new Map();
const audioContext = () => (audio ??= new AudioContext());

function setTone(id, frequency) {
  const existing = tones.get(id);
  if (!frequency) {
    existing?.stop();
    tones.delete(id);
    return;
  }
  if (existing) {
    existing.frequency.value = frequency;
    return;
  }
  const context = audioContext();
  const oscillator = context.createOscillator();
  const volume = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = frequency;
  volume.gain.value = 0.04;
  oscillator.connect(volume).connect(context.destination);
  oscillator.start();
  tones.set(id, oscillator);
}

function stopSound() {
  for (const id of [...tones.keys()]) setTone(id, 0);
}

let pcmTime = 0;
function playSamples(samples, rate, channels) {
  const context = audioContext();
  const frames = Math.floor(samples.length / channels);
  if (frames === 0) return;
  const buffer = context.createBuffer(channels, frames, rate);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++) data[i] = samples[i * channels + c] / 32768;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  pcmTime = Math.max(pcmTime, context.currentTime + 0.02);
  source.start(pcmTime);
  pcmTime += buffer.duration;
}

// --- OLED ---

function oledImage(view) {
  if (!view.on) return null;
  const bytes = Uint8Array.from(atob(view.pixels), (c) => c.charCodeAt(0));
  const surface = document.createElement('canvas');
  surface.width = 128;
  surface.height = 64;
  const context = surface.getContext('2d');
  const image = context.createImageData(128, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 128; x++) {
      const on = (bytes[(y >> 3) * 128 + x] >> (y & 7)) & 1;
      const offset = (y * 128 + x) * 4;
      image.data[offset] = on ? 120 : 0;
      image.data[offset + 1] = on ? 220 : 0;
      image.data[offset + 2] = on ? 255 : 0;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return surface.toDataURL();
}

// --- Messages from the extension ---

function applyFrame({ views, board, problems }) {
  for (const [id, view] of Object.entries(views)) {
    const part = partById(id);
    if (part?.type === 'oled-ssd1306' && view.pixels !== undefined) view.image = oledImage(view);
    state.views[id] = view;
    if (view.tone !== undefined) setTone(id, view.tone);
    updatePart(id);
  }
  const boardText = JSON.stringify(board);
  if (boardText !== state.boardText) {
    state.boardText = boardText;
    state.board = board;
    updatePart(state.doc.parts.find((p) => p.type === BOARD_TYPE).id);
  }
  const problemText = JSON.stringify(problems);
  if (problemText !== state.problemText) {
    state.problemText = problemText;
    state.problems = problems;
    renderProblems();
  }
}

function setRunning(running) {
  const wasRunning = state.running;
  state.running = running;
  state.wiring = null;
  // Every run is a new board, with all its parts and controls back at their defaults.
  state.views = {};
  state.board = {};
  state.boardText = undefined;
  state.controlValues = {};
  stopSound();
  if (running && !wasRunning) audioContext().resume?.();
  $('status').textContent = running ? 'Running' : 'Stopped';
  render();
}

const handlers = {
  load(message) {
    state.doc = message.circuit ?? emptyCircuit();
    state.loadError = message.error;
    state.undo = [];
    state.redo = [];
    state.selection = null;
    render();
    fit();
  },
  serial: (message) => appendSerial(message.text),
  clearConsole() {
    consoleElement.textContent = '';
    partialSerial = '';
  },
  frame: applyFrame,
  running: (message) => setRunning(message.running),
  audioStart(message) {
    state.audioFormat = message;
    pcmTime = 0;
  },
  audio(message) {
    if (state.audioFormat) playSamples(message.samples, state.audioFormat.sampleRate, state.audioFormat.channels);
  },
  // Used by the automated tests.
  async test(message) {
    const { runTestStep } = await import('./test-driver.js');
    const result = await runTestStep(message.step, { state, vscode, toScreen, render, fit });
    vscode.postMessage({ type: 'testResult', id: message.id, result });
  },
};

function toScreen(point) {
  const box = canvas.getBoundingClientRect();
  return { clientX: box.left + point.x * state.zoom + state.pan.x, clientY: box.top + point.y * state.zoom + state.pan.y };
}

window.addEventListener('message', ({ data }) => handlers[data.type]?.(data));

// --- Startup ---

$('defs').innerHTML = holePattern();
$('run').addEventListener('click', () => vscode.postMessage({ type: 'run' }));
$('stop').addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
$('undo').addEventListener('click', () => restore(state.undo, state.redo));
$('redo').addEventListener('click', () => restore(state.redo, state.undo));
$('rotate').addEventListener('click', rotateSelection);
$('delete').addEventListener('click', deleteSelection);
$('fit').addEventListener('click', fit);
$('search').addEventListener('input', (event) => renderPalette(event.target.value));
$('parts').addEventListener('click', (event) => {
  const type = event.target.dataset?.add;
  if (type) addPart(type);
});
$('tab-console').addEventListener('click', () => showTab('console'));
$('tab-problems').addEventListener('click', () => showTab('problems'));
new ResizeObserver(() => applyTransform()).observe(canvas);

renderPalette();
renderProblems();
render();
applyTransform();
vscode.postMessage({ type: 'ready' });
