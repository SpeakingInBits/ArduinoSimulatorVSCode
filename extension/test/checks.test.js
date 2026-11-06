// Tests the out-of-spec checks and the multimeter without running any firmware.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOARD_PINS, CATALOG, SUPPLY_LIMITS, defaultProps, emptyCircuit } from '../shared/catalog.js';
import { unsimulated } from '../shared/nets.js';
import { Circuit, PIN_MODE } from '../sim/circuit.js';

const AMPS = 1;
const OHMS = 2;

function wired(wires) {
  return wires.map(([from, to], i) => {
    const [fromPart, fromPin] = from.split(':');
    const [toPart, toPin] = to.split(':');
    return { id: `w${i}`, from: { part: fromPart, pin: fromPin }, to: { part: toPart, pin: toPin } };
  });
}

function document(parts, wires) {
  const doc = emptyCircuit();
  parts.forEach((part, i) => doc.parts.push({ x: 0, y: 500 + 300 * i, rotation: 0, props: defaultProps(part.type), ...part }));
  doc.wires = wired(wires);
  return doc;
}

function build(parts, wires) {
  let time = 0;
  const circuit = new Circuit(document(parts, wires), { now: () => time, random: () => 0.25 });
  const frame = () => {
    time += 100;
    circuit.frame(time);
  };
  return {
    circuit,
    frame,
    control: (id, control, value) => circuit.setControl(id, control, value),
    output(name, value) {
      circuit.pinMode(BOARD_PINS[name], PIN_MODE.OUTPUT, 0, false);
      circuit.pinWrite(BOARD_PINS[name], value);
    },
    pwm(name, frequency, duty) {
      circuit.pinMode(BOARD_PINS[name], PIN_MODE.PWM, 0, false);
      circuit.pwmSet(BOARD_PINS[name], frequency, duty * 65535);
    },
    view(id) {
      frame();
      const entry = circuit.parts.get(id);
      return entry.model.view(entry.context);
    },
    problems(severity) {
      frame();
      return [...circuit.problems.values()].filter((p) => !severity || p.severity === severity);
    },
    messages(severity) {
      return this.problems(severity).map((p) => p.message);
    },
  };
}

const hasMessage = (messages, text) => assert.ok(messages.some((m) => m.includes(text)), `no "${text}" in ${JSON.stringify(messages)}`);

test('every supply limit names real pins', () => {
  for (const [type, [positive, negative]] of Object.entries(SUPPLY_LIMITS)) {
    const pins = CATALOG[type].pins.map((p) => p.id);
    assert.ok(pins.includes(positive) && pins.includes(negative), type);
  }
});

test('a resistor over its power rating is an error, and one within it is not', () => {
  const hot = build([{ id: 'b', type: 'battery' }, { id: 'r', type: 'resistor', props: { ohms: 100 } }],
    [['b:+', 'r:1'], ['r:2', 'b:-'], ['b:-', 'board:GND1']]);
  hasMessage(hot.messages('error'), 'above its 0.25W rating');

  const fine = build([{ id: 'r', type: 'resistor', props: { ohms: 220 } }], [['board:3V', 'r:1'], ['r:2', 'board:GND1']]);
  assert.deepEqual(fine.messages(), []);
});

test('resistor power follows the PWM duty cycle', () => {
  const sim = build([{ id: 'b', type: 'battery' }, { id: 'r', type: 'resistor', props: { ohms: 100 } }, { id: 'm', type: 'nmos' }],
    [['b:+', 'r:1'], ['r:2', 'm:D'], ['m:S', 'board:GND1'], ['b:-', 'board:GND1'], ['board:D9', 'm:G']]);
  sim.pwm('D9', 1000, 0.1);
  assert.deepEqual(sim.messages('error'), [], 'only 10% of the time');
  sim.pwm('D9', 1000, 0.9);
  hasMessage(sim.messages('error'), 'above its 0.25W rating');
});

test('an electrolytic capacitor wired backwards is an error, and a small ceramic one is not', () => {
  const wires = [['c:+', 'board:GND1'], ['c:-', 'board:5V']];
  hasMessage(build([{ id: 'c', type: 'capacitor' }], wires).messages('error'), 'wired backwards');
  assert.deepEqual(build([{ id: 'c', type: 'capacitor', props: { microfarads: 0.1 } }], wires).messages(), []);
});

test('a diode straight across a supply is an error', () => {
  const sim = build([{ id: 'd', type: 'diode' }], [['d:A', 'board:5V'], ['d:K', 'board:GND1']]);
  hasMessage(sim.messages('error'), 'above its 1A limit');
});

test('a transistor base with no resistor is an error at its base pin', () => {
  const sim = build([{ id: 'q', type: 'npn' }], [['board:5V', 'q:B'], ['q:E', 'board:GND1']]);
  const problem = sim.problems('error').find((p) => p.part === 'q');
  assert.match(problem.message, /Add a base resistor/);
  assert.equal(problem.pin, 'B');
});

test('a shorted battery is an error', () => {
  const sim = build([{ id: 'b', type: 'battery' }], [['b:+', 'b:-']]);
  hasMessage(sim.messages('error'), 'above its 2A limit');
});

test('pressing a button across a supply overloads it, at that supply pin', () => {
  const sim = build([{ id: 'b', type: 'button' }], [['b:1a', 'board:3V'], ['b:2a', 'board:GND1']]);
  assert.deepEqual(sim.messages(), []);
  sim.control('b', 'pressed', 1);
  const problem = sim.problems('error').find((p) => p.message.includes('The 3V supply'));
  assert.equal(problem.pin, '3V');
});

test('a part on too high a voltage, or with its supply swapped, is an error', () => {
  const high = build([{ id: 'b', type: 'battery' }, { id: 's', type: 'servo' }], [['b:+', 's:V+'], ['b:-', 's:GND'], ['b:-', 'board:GND1']]);
  hasMessage(high.messages('error'), 'above its 6.5V limit');

  const swapped = build([{ id: 's', type: 'hcsr04' }], [['s:VCC', 'board:GND1'], ['s:GND', 'board:5V']]);
  hasMessage(swapped.messages('error'), 'wired backwards');

  const fine = build([{ id: 's', type: 'hcsr04' }], [['s:VCC', 'board:5V'], ['s:GND', 'board:GND1']]);
  assert.deepEqual(fine.messages(), []);
});

test('a backwards LED is a warning, and a large reverse voltage is an error', () => {
  const backwards = build([{ id: 'r', type: 'resistor' }, { id: 'l', type: 'led' }], [['board:3V', 'r:1'], ['r:2', 'l:K'], ['l:A', 'board:GND1']]);
  hasMessage(backwards.messages('warning'), 'This LED is backwards');

  const battery = build([{ id: 'b', type: 'battery' }, { id: 'l', type: 'led' }], [['b:+', 'l:K'], ['b:-', 'l:A'], ['b:-', 'board:GND1']]);
  hasMessage(battery.messages('error'), 'backwards, above its 5V limit');
});

test('a burned LED stays a problem for the rest of the run', () => {
  const sim = build([{ id: 'l', type: 'led' }], [['board:5V', 'l:A'], ['l:K', 'board:GND1']]);
  sim.view('l');
  for (let i = 0; i < 30; i++) sim.view('l');
  hasMessage(sim.messages('error'), 'burned out');
});

test('a board pin problem says which pin', () => {
  const sim = build([{ id: 'r', type: 'resistor', props: { ohms: 100 } }], [['board:D2', 'r:1'], ['r:2', 'board:GND1']]);
  sim.output('D2', 1);
  const problem = sim.problems('error').find((p) => p.message.includes('above its 10mA limit'));
  assert.equal(problem.part, 'board');
  assert.equal(problem.pin, 'D2');
});

test('a multimeter measures volts without disturbing the circuit', () => {
  const sim = build([
    { id: 'r1', type: 'resistor', props: { ohms: 1000 } }, { id: 'r2', type: 'resistor', props: { ohms: 1000 } }, { id: 'm', type: 'multimeter' },
  ], [['board:3V', 'r1:1'], ['r1:2', 'r2:1'], ['r2:2', 'board:GND1'], ['m:V', 'r1:2'], ['m:COM', 'board:GND1']]);
  assert.deepEqual(sim.view('m'), { mode: 0, reading: '1.65', unit: 'V' });
});

test('a multimeter reads a PWM pin as its average', () => {
  const sim = build([{ id: 'm', type: 'multimeter' }], [['m:V', 'board:D9'], ['m:COM', 'board:GND1']]);
  sim.pwm('D9', 1000, 0.25);
  sim.frame();
  assert.ok(Math.abs(Number(sim.view('m').reading) - 0.825) < 0.02);
});

test('a multimeter measures amps in series, and the circuit stays broken in volts mode', () => {
  const sim = build([{ id: 'r', type: 'resistor', props: { ohms: 1000 } }, { id: 'm', type: 'multimeter' }],
    [['board:3V', 'm:V'], ['m:COM', 'r:1'], ['r:2', 'board:GND1']]);
  sim.control('m', 'mode', AMPS);
  assert.deepEqual(sim.view('m'), { mode: AMPS, reading: '3.3', unit: 'mA' });
});

test('a multimeter measures a resistor, an open circuit and a live circuit', () => {
  const wires = [['m:V', 'r:1'], ['m:COM', 'r:2']];
  const resistor = build([{ id: 'r', type: 'resistor', props: { ohms: 4700 } }, { id: 'm', type: 'multimeter' }], wires);
  resistor.control('m', 'mode', OHMS);
  assert.deepEqual(resistor.view('m'), { mode: OHMS, reading: '4.70', unit: 'kΩ' });

  const open = build([{ id: 'm', type: 'multimeter' }], []);
  open.control('m', 'mode', OHMS);
  assert.equal(open.view('m').reading, 'OL');

  const live = build([{ id: 'm', type: 'multimeter' }], [['m:V', 'board:3V'], ['m:COM', 'board:GND1']]);
  live.control('m', 'mode', OHMS);
  assert.equal(live.view('m').reading, 'LIVE');
  hasMessage(live.messages('warning'), 'unpowered');
});

test('a multimeter across a supply in amps mode blows its fuse for good', () => {
  const sim = build([{ id: 'm', type: 'multimeter' }], [['m:V', 'board:3V'], ['m:COM', 'board:GND1']]);
  sim.control('m', 'mode', AMPS);
  hasMessage(sim.messages('error'), 'blew its fuse');
  assert.equal(sim.view('m').reading, 'FUSE');
  sim.control('m', 'mode', 0);
  sim.control('m', 'mode', AMPS);
  for (let i = 0; i < 15; i++) sim.frame();
  assert.equal(sim.view('m').reading, 'FUSE');
  assert.equal(sim.messages('error').filter((m) => m.includes('The 3V supply')).length, 0, 'the supply recovers once the fuse opens');
});

test('parts with no path to the board or a battery are left out of the simulation', () => {
  const doc = document([
    { id: 'lit', type: 'led' }, { id: 'r', type: 'resistor' }, { id: 'lone', type: 'led' }, { id: 'pair1', type: 'button' }, { id: 'pair2', type: 'led' },
    { id: 'b', type: 'battery' }, { id: 'powered', type: 'led' }, { id: 'n', type: 'note' },
  ], [['board:D2', 'r:1'], ['r:2', 'lit:A'], ['pair1:1a', 'pair2:A'], ['b:+', 'powered:A']]);
  const { parts, wires } = unsimulated(doc);
  assert.deepEqual([...parts].sort(), ['lone', 'pair1', 'pair2']);
  assert.deepEqual([...wires].map((wire) => wire.id), ['w2']);
});
