// Tests the electrical model without running any firmware.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOARD_PINS, CATALOG, defaultProps, emptyCircuit, pinPosition } from '../shared/catalog.js';
import { buildNets, pinKey } from '../shared/nets.js';
import { Circuit, PIN_MODE } from '../sim/circuit.js';
import { MODELS } from '../sim/models.js';
import { Solver } from '../sim/solver.js';

let nextId = 0;
function build(parts, wires) {
  const doc = emptyCircuit();
  for (const part of parts) doc.parts.push({ x: 0, y: 500 + 300 * nextId++, rotation: 0, props: defaultProps(part.type), ...part });
  doc.wires = wires.map(([from, to]) => {
    const [fromPart, fromPin] = from.split(':');
    const [toPart, toPin] = to.split(':');
    return { from: { part: fromPart, pin: fromPin }, to: { part: toPart, pin: toPin } };
  });
  let time = 0;
  const posts = [];
  const circuit = new Circuit(doc, { now: () => time, post: (m) => posts.push(m), random: () => 0.25 });
  return {
    circuit,
    posts,
    advance(ms) {
      time += ms;
      circuit.tick();
    },
    output(name, value) {
      circuit.pinMode(BOARD_PINS[name], PIN_MODE.OUTPUT, 0, false);
      circuit.pinWrite(BOARD_PINS[name], value);
    },
    input(name, pull = 0) {
      circuit.pinMode(BOARD_PINS[name], PIN_MODE.INPUT, pull, false);
      return circuit.pinRead(BOARD_PINS[name]);
    },
    view(id) {
      circuit.frame(time + 100);
      time += 100;
      return circuit.parts.get(id).model.view(circuit.parts.get(id).context);
    },
    problems() {
      circuit.frame(time + 100);
      time += 100;
      return [...circuit.problems.values()].map((p) => p.message);
    },
  };
}

test('solver: voltage divider', () => {
  const solver = new Solver(2, [3.3]);
  solver.resistor(-1, 1, 1000);
  solver.resistor(1, 0, 2000);
  solver.solve();
  assert.ok(Math.abs(solver.v(1) - 2.2) < 0.001);
});

test('solver: LED and resistor from a rail', () => {
  const solver = new Solver(2, [3.3]);
  const resistor = solver.resistor(-1, 1, 220);
  solver.diode(1, 0, 1.8, 8);
  solver.solve();
  const current = solver.currentThrough(resistor);
  assert.ok(current > 0.005 && current < 0.007, `current ${current}`);
});

test('solver: transistor switches a load from its base', () => {
  const solver = new Solver(3, [5, 3.3]);
  const load = solver.resistor(-1, 1, 100);
  const base = solver.source(2, 0, 3.3, 1000);
  solver.npn(2, 1, 0);
  solver.solve();
  assert.ok(solver.currentThrough(load) > 0.04, 'on');
  base.volts = 0;
  solver.solve();
  assert.ok(Math.abs(solver.currentThrough(load)) < 1e-6, 'off');
});

test('every placeable part has a model or is deliberately passive', () => {
  const passive = new Set(['metro-m0-express', 'breadboard-half', 'breadboard-full', 'capacitor']);
  for (const type of Object.keys(CATALOG)) {
    assert.ok(MODELS[type] || passive.has(type), `${type} has no model`);
  }
});

test('every part builds alone without crashing', () => {
  for (const type of Object.keys(CATALOG)) {
    if (type === 'metro-m0-express') continue;
    const sim = build([{ id: 'p', type }], []);
    sim.advance(50);
    sim.advance(50);
  }
});

test('nets: pin in a breadboard hole joins its row', () => {
  const doc = emptyCircuit();
  doc.parts.push({ id: 'bb', type: 'breadboard-half', x: 0, y: 300, rotation: 0, props: {} });
  doc.parts.push({ id: 'r', type: 'resistor', x: 20, y: 350, rotation: 0, props: { ohms: 220 } });
  doc.parts.push({ id: 'l', type: 'led', x: 20, y: 380, rotation: 0, props: { color: 'red' } });
  const { sameNet } = buildNets(doc);
  assert.ok(sameNet(pinKey('r', '1'), pinKey('l', 'A')), 'resistor lead a1 and LED anode d1 share a column');
  assert.ok(!sameNet(pinKey('r', '2'), pinKey('l', 'A')));
});

test('nets: rotation moves pins on the grid', () => {
  const part = { x: 100, y: 100, rotation: 90 };
  assert.deepEqual(pinPosition(part, { x: 40, y: 0 }), { x: 100, y: 140 });
});

test('LED with a resistor lights, and without one it burns out', () => {
  const good = build([{ id: 'r', type: 'resistor' }, { id: 'l', type: 'led' }],
    [['board:D2', 'r:1'], ['r:2', 'l:A'], ['l:K', 'board:GND1']]);
  good.output('D2', 1);
  assert.ok(good.view('l').brightness > 0.5);
  good.output('D2', 0);
  assert.equal(good.view('l').brightness, 0);

  const bad = build([{ id: 'l', type: 'led' }], [['board:5V', 'l:A'], ['l:K', 'board:GND1']]);
  assert.equal(bad.view('l').burned, true);
  assert.ok(bad.problems().some((message) => message.includes('burned out')));
});

test('LED across rails with no unknown nodes still solves', () => {
  const sim = build([{ id: 'l', type: 'led', props: { color: 'blue' } }], [['board:3V', 'l:A'], ['l:K', 'board:GND1']]);
  assert.ok(sim.view('l').brightness > 0 || sim.view('l').burned);
});

test('button with internal pull-up reads high, then low when pressed', () => {
  const sim = build([{ id: 'b', type: 'button' }], [['board:D2', 'b:1a'], ['b:2a', 'board:GND1']]);
  assert.equal(sim.input('D2', 1), 1);
  sim.circuit.setControl('b', 'pressed', 1);
  assert.equal(sim.input('D2', 1), 0);
});

test('unconnected input floats and warns', () => {
  const sim = build([], []);
  sim.input('D2', 0);
  assert.ok(sim.problems().some((message) => message.includes('floating')));
});

test('potentiometer divides the voltage for the ADC', () => {
  const sim = build([{ id: 'p', type: 'potentiometer' }],
    [['board:3V', 'p:2'], ['p:1', 'board:GND1'], ['p:W', 'board:A0']]);
  sim.circuit.pinMode(BOARD_PINS.A0, PIN_MODE.ANALOG_IN, 0, false);
  sim.circuit.setControl('p', 'position', 0.25);
  const raw = sim.circuit.adcRead(BOARD_PINS.A0);
  assert.ok(Math.abs(raw - 1024) < 8, `raw ${raw}`);
});

test('photoresistor divider rises with light', () => {
  const sim = build([{ id: 'l', type: 'photoresistor' }, { id: 'r', type: 'resistor', props: { ohms: 10000 } }],
    [['board:3V', 'l:1'], ['l:2', 'board:A1'], ['l:2', 'r:1'], ['r:2', 'board:GND1']]);
  sim.circuit.pinMode(BOARD_PINS.A1, PIN_MODE.ANALOG_IN, 0, false);
  sim.circuit.setControl('l', 'light', 0.1);
  const dark = sim.circuit.adcRead(BOARD_PINS.A1);
  sim.circuit.setControl('l', 'light', 0.9);
  assert.ok(sim.circuit.adcRead(BOARD_PINS.A1) > dark + 1000);
});

test('5V into a pin is reported', () => {
  const sim = build([], [['board:5V', 'board:D3']]);
  assert.ok(sim.problems().some((message) => message.includes('only tolerate 3.3V')));
});

test('wiring 3V straight to GND is a short circuit', () => {
  const sim = build([], [['board:3V', 'board:GND1']]);
  assert.ok(sim.problems().some((message) => message.includes('Short circuit')));
});

test('motor on a bare pin overloads it, and a transistor fixes that', () => {
  const direct = build([{ id: 'm', type: 'dc-motor' }], [['board:D9', 'm:1'], ['m:2', 'board:GND1']]);
  direct.output('D9', 1);
  assert.ok(direct.problems().some((message) => message.includes('above its 10mA limit')));

  const driven = build([{ id: 'm', type: 'dc-motor' }, { id: 't', type: 'npn' }, { id: 'r', type: 'resistor', props: { ohms: 1000 } }],
    [['board:5V', 'm:1'], ['m:2', 't:C'], ['t:E', 'board:GND1'], ['board:D9', 'r:1'], ['r:2', 't:B']]);
  driven.output('D9', 1);
  assert.ok(driven.view('m').speed > 0.5);
  assert.ok(!driven.problems().some((message) => message.includes('mA')));
  driven.output('D9', 0);
  assert.equal(driven.view('m').speed, 0);
});

test('PWM dims an LED and sets a servo angle', () => {
  const sim = build([{ id: 'r', type: 'resistor' }, { id: 'l', type: 'led' }, { id: 's', type: 'servo' }],
    [['board:D5', 'r:1'], ['r:2', 'l:A'], ['l:K', 'board:GND1'], ['board:5V', 's:V+'], ['s:GND', 'board:GND1'], ['board:D9', 's:SIG']]);
  sim.circuit.pinMode(BOARD_PINS.D5, PIN_MODE.PWM, 0, false);
  sim.circuit.pwmSet(BOARD_PINS.D5, 500, 65535);
  const full = sim.view('l').brightness;
  sim.circuit.pwmSet(BOARD_PINS.D5, 500, 6553);
  assert.ok(sim.view('l').brightness < full / 1.5);
  sim.circuit.pinMode(BOARD_PINS.D9, PIN_MODE.PWM, 0, false);
  sim.circuit.pwmSet(BOARD_PINS.D9, 50, Math.round((1.5 / 20) * 65535));
  assert.equal(sim.view('s').angle, 90);
});

test('shift register shifts, latches and drives an LED', () => {
  const sim = build([{ id: 'sr', type: 'shift-register' }, { id: 'r', type: 'resistor' }, { id: 'l', type: 'led' }],
    [['board:3V', 'sr:VCC'], ['sr:GND', 'board:GND1'], ['board:3V', 'sr:MR'], ['sr:OE', 'board:GND1'],
      ['board:D2', 'sr:DS'], ['board:D3', 'sr:SHCP'], ['board:D4', 'sr:STCP'],
      ['sr:Q0', 'r:1'], ['r:2', 'l:A'], ['l:K', 'board:GND1']]);
  for (const name of ['D2', 'D3', 'D4']) sim.output(name, 0);
  sim.output('D2', 1);
  sim.output('D3', 1);
  sim.output('D3', 0);
  assert.equal(sim.view('l').brightness, 0, 'nothing shows until latched');
  sim.output('D4', 1);
  sim.output('D4', 0);
  assert.ok(sim.view('l').brightness > 0);
  assert.equal(sim.view('sr').value, 1);
});

test('relay module switches a separate circuit', () => {
  const sim = build([{ id: 'k', type: 'relay-module' }, { id: 'r', type: 'resistor' }, { id: 'l', type: 'led' }],
    [['board:5V', 'k:VCC'], ['k:GND', 'board:GND1'], ['board:D2', 'k:IN'], ['board:3V', 'k:COM'], ['k:NO', 'r:1'], ['r:2', 'l:A'], ['l:K', 'board:GND1']]);
  sim.output('D2', 1);
  assert.equal(sim.view('l').brightness, 0);
  sim.output('D2', 0);
  assert.ok(sim.view('l').brightness > 0);
});

test('HC-SR04 echoes for a time matching the distance', () => {
  const sim = build([{ id: 'u', type: 'hcsr04' }],
    [['board:5V', 'u:VCC'], ['u:GND', 'board:GND1'], ['board:D2', 'u:TRIG'], ['board:D3', 'u:ECHO']]);
  sim.circuit.setControl('u', 'distance', 100);
  sim.output('D2', 0);
  sim.input('D3', 0);
  sim.output('D2', 1);
  sim.output('D2', 0);
  sim.advance(1);
  assert.equal(sim.input('D3', 0), 1, 'echo started');
  sim.advance(4);
  assert.equal(sim.input('D3', 0), 1, 'echo continues');
  sim.advance(2);
  assert.equal(sim.input('D3', 0), 0, 'echo ended near 5.83ms');
});

test('I2C device must be wired to answer, and pull-ups come from the breakout', () => {
  const wired = build([{ id: 't', type: 'mcp9808' }],
    [['board:3V', 't:VCC'], ['t:GND', 'board:GND1'], ['board:SDA', 't:SDA'], ['board:SCL', 't:SCL']]);
  assert.equal(wired.circuit.i2cDevice(0x18)?.part.id, 't');
  assert.ok(wired.circuit.i2cPullups(BOARD_PINS.SCL, BOARD_PINS.SDA));

  const empty = build([{ id: 't', type: 'mcp9808' }], [['board:3V', 't:VCC']]);
  assert.equal(empty.circuit.i2cDevice(0x18), undefined);
  assert.ok(!empty.circuit.i2cPullups(BOARD_PINS.SCL, BOARD_PINS.SDA));
});

test('keypad closes one row and column', () => {
  const sim = build([{ id: 'k', type: 'keypad-4x4' }], [['board:D2', 'k:R1'], ['board:D3', 'k:C2']]);
  sim.output('D3', 0);
  assert.equal(sim.input('D2', 1), 1);
  sim.circuit.setControl('k', 'key', 2);
  assert.equal(sim.input('D2', 1), 0);
});

test('fast-toggled pin shows as a dim LED', () => {
  const sim = build([{ id: 'r', type: 'resistor' }, { id: 'l', type: 'led' }],
    [['board:D2', 'r:1'], ['r:2', 'l:A'], ['l:K', 'board:GND1']]);
  sim.output('D2', 0);
  for (let i = 0; i < 20; i++) {
    sim.output('D2', 1);
    sim.advance(0.5);
    sim.output('D2', 0);
    sim.advance(1.5);
  }
  sim.circuit.frame(sim.circuit.now());
  const { brightness } = sim.circuit.parts.get('l').model.view(sim.circuit.parts.get('l').context);
  assert.ok(brightness > 0.2 && brightness < 0.8, `brightness ${brightness}`);
});
