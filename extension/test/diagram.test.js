import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { CATALOG, circuitProblem, defaultProps, definition, emptyCircuit } from '../shared/catalog.js';
import { renderDiagram, symbolOf } from '../webview/diagram-art.js';
import { layoutDiagram } from '../webview/diagram-layout.js';

const examples = fs.readdirSync(new URL('../examples/', import.meta.url));
const example = (name) => JSON.parse(fs.readFileSync(new URL(`../examples/${name}/circuit.json`, import.meta.url), 'utf8'));

const part = (id, type, x = 0, y = 0, props = defaultProps(type)) => ({ id, type, x, y, rotation: 0, props });
const wire = (id, from, to) => {
  const end = (text) => {
    const [partId, pin] = text.split('.');
    return { part: partId, pin };
  };
  return { id, from: end(from), to: end(to), points: [], color: '#222' };
};

// Parts are spread out, so that only wires join them.
function circuit(parts, wires) {
  const doc = emptyCircuit();
  parts.forEach((item, i) => doc.parts.push({ ...item, x: 1000 + i * 500, y: 1000 }));
  doc.wires = wires.map(([from, to], i) => wire(`w${i}`, from, to));
  return doc;
}

const horizontal = ([, y1, , y2]) => y1 === y2;
const low = ([x1, y1, x2, y2]) => [Math.min(x1, x2), Math.min(y1, y2)];
const high = ([x1, y1, x2, y2]) => [Math.max(x1, x2), Math.max(y1, y2)];
const onSegment = (segment, [x, y]) => {
  const [left, top] = low(segment);
  const [right, bottom] = high(segment);
  return x >= left && x <= right && y >= top && y <= bottom;
};

// A schematic that looks joined where it isn't is wrong, so this checks the drawing itself.
function assertSound(model, label) {
  for (const value of JSON.stringify(model).match(/null/g) ?? []) assert.fail(`${label}: a position is missing (${value})`);

  // A net's wires join all of its pins.
  for (const item of model.wires) {
    const pieces = item.segments.map((segment) => new Set([segment]));
    const touching = (a, b) => [low(a), high(a)].some((point) => onSegment(b, point)) || [low(b), high(b)].some((point) => onSegment(a, point));
    for (let i = 0; i < pieces.length; i++) {
      for (let j = pieces.length - 1; j > i; j--) {
        if ([...pieces[i]].some((a) => [...pieces[j]].some((b) => touching(a, b)))) {
          for (const segment of pieces[j]) pieces[i].add(segment);
          pieces.splice(j, 1);
          j = pieces.length;
        }
      }
    }
    assert.equal(pieces.length, 1, `${label}: net ${item.name} is drawn in ${pieces.length} pieces`);
    for (const pin of model.parts.flatMap((p) => p.pins).filter((p) => p.net === item.net)) {
      assert.ok(item.segments.some((segment) => onSegment(segment, [pin.x, pin.y])), `${label}: net ${item.name} misses a pin at ${pin.x},${pin.y}`);
    }
  }

  // Two nets may cross, but never run along each other or end on one another.
  for (let i = 0; i < model.wires.length; i++) {
    for (let j = i + 1; j < model.wires.length; j++) {
      for (const a of model.wires[i].segments) {
        for (const b of model.wires[j].segments) {
          const message = `${label}: ${model.wires[i].name} and ${model.wires[j].name} look joined at ${a} / ${b}`;
          if (horizontal(a) === horizontal(b)) {
            const [ax, ay] = low(a);
            const [bx, by] = low(b);
            const [cx, cy] = high(a);
            const [dx, dy] = high(b);
            assert.ok(ax > dx || bx > cx || ay > dy || by > cy, message);
          } else {
            for (const end of [low(a), high(a)]) assert.ok(!onSegment(b, end), message);
            for (const end of [low(b), high(b)]) assert.ok(!onSegment(a, end), message);
          }
        }
      }
    }
  }

  // Wires go around parts, and parts don't sit on each other.
  for (const box of model.parts) {
    const isInside = ([x, y]) => x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h;
    for (const item of model.wires) {
      for (const segment of item.segments) {
        const [left, top] = low(segment);
        const [right, bottom] = high(segment);
        const through = left < box.x + box.w && right > box.x && top < box.y + box.h && bottom > box.y;
        assert.ok(!through && !isInside(low(segment)), `${label}: ${item.name} runs through ${box.id}`);
      }
    }
    for (const other of model.parts) {
      if (other === box) continue;
      const apart = box.x + box.w <= other.x || other.x + other.w <= box.x || box.y + box.h <= other.y || other.y + other.h <= box.y;
      assert.ok(apart, `${label}: ${box.id} overlaps ${other.id}`);
    }
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= model.width && box.y + box.h <= model.height, `${label}: ${box.id} is off the page`);
  }
}

const pinsOf = (model, id) => Object.fromEntries(model.parts.find((p) => p.id === id).pins.map((pin) => [pin.id, pin]));

test('every example gives a sound diagram', () => {
  assert.ok(examples.length > 0);
  for (const name of examples) assertSound(layoutDiagram(example(name)), name);
});

test('a chain reads from the board outwards in one straight line', () => {
  const model = layoutDiagram(circuit([part('r1', 'resistor'), part('led1', 'led')], [
    ['board.D5', 'r1.1'], ['r1.2', 'led1.A'], ['led1.K', 'board.GND1'],
  ]));
  const board = pinsOf(model, 'board');
  const resistor = pinsOf(model, 'r1');
  const led = pinsOf(model, 'led1');
  assert.ok(board.D5.x < resistor['1'].x && resistor['2'].x < led.A.x && led.A.x < led.K.x);
  assert.deepEqual([resistor['1'].y, resistor['2'].y, led.A.y], [board.D5.y, board.D5.y, board.D5.y]);
  assertSound(model, 'chain');
});

test('a breadboard joins parts in the diagram but is not drawn', () => {
  const model = layoutDiagram(example('led-and-button'));
  assert.ok(!model.parts.some((p) => p.type.startsWith('breadboard')));
  assert.deepEqual(model.parts.map((p) => p.id).sort(), ['board', 'button1', 'led1', 'r1']);
  const r = pinsOf(model, 'r1');
  assert.equal(r['1'].net, pinsOf(model, 'board').D5.net);
  assert.equal(r['2'].net, pinsOf(model, 'led1').A.net);
});

test('power and ground are marked at each pin, not drawn as wires', () => {
  const model = layoutDiagram(circuit([part('pot', 'potentiometer')], [
    ['board.3V', 'pot.2'], ['pot.1', 'board.GND1'], ['pot.W', 'board.A0'],
  ]));
  assert.deepEqual(model.wires.map((item) => item.name), ['A0']);
  assert.deepEqual(model.flags.map((flag) => flag.label).sort(), ['3.3V', '3.3V', 'GND', 'GND']);
  assert.equal(model.nets, 1);
  assertSound(model, 'pot');
});

test('a part turns round so its wired pin faces the board', () => {
  const pot = layoutDiagram(circuit([part('pot', 'potentiometer')], [['pot.W', 'board.A0']]));
  assert.equal(pinsOf(pot, 'pot').W.side, 'L');
  assert.equal(pot.parts.find((p) => p.id === 'pot').flipped, true);
  const reversed = layoutDiagram(circuit([part('led1', 'led')], [['led1.K', 'board.D5']]));
  assert.deepEqual([pinsOf(reversed, 'led1').K.side, pinsOf(reversed, 'led1').A.side], ['L', 'R']);
});

test('the board shows only the pins in use, in reading order, with ground once', () => {
  const model = layoutDiagram(circuit([part('a', 'resistor'), part('b', 'resistor'), part('c', 'resistor')], [
    ['board.A1', 'a.1'], ['board.D12', 'b.1'], ['board.D3', 'c.1'], ['a.2', 'board.GND1'], ['b.2', 'board.GND2'], ['c.2', 'board.GND3'],
  ]));
  assert.deepEqual(model.parts.find((p) => p.id === 'board').pins.map((pin) => pin.id), ['D3', 'D12', 'A1', 'GND3']);
});

test('nets that branch or skip a column stay sound', () => {
  const divider = layoutDiagram(circuit([part('r1', 'resistor'), part('ldr', 'photoresistor')], [
    ['board.3V', 'r1.1'], ['r1.2', 'ldr.1'], ['ldr.2', 'board.GND1'], ['r1.2', 'board.A0'],
  ]));
  assert.equal(divider.wires[0].junctions.length, 1);
  assertSound(divider, 'divider');

  // The last resistor's far end comes back to the board, past the parts in the way.
  assertSound(layoutDiagram(circuit([part('r1', 'resistor'), part('r2', 'resistor'), part('r3', 'resistor')], [
    ['board.D2', 'r1.1'], ['r1.2', 'r2.1'], ['r2.2', 'r3.1'], ['r3.2', 'board.D3'],
  ])), 'loop');
  assertSound(layoutDiagram(circuit([part('button1', 'button')], [['button1.1a', 'board.D2'], ['button1.2a', 'board.D3']])), 'both to board');
  assertSound(layoutDiagram(circuit([part('r1', 'resistor')], [['r1.1', 'r1.2'], ['r1.1', 'board.D2']])), 'shorted part');
});

test('a battery names its own supply until its negative joins ground', () => {
  const alone = layoutDiagram(circuit([part('bat', 'battery'), part('m', 'dc-motor')], [['bat.+', 'm.1'], ['bat.-', 'm.2']]));
  assert.deepEqual([...new Set(alone.flags.map((flag) => flag.label))].sort(), ['9V', 'BAT-']);
  const grounded = layoutDiagram(circuit([part('bat', 'battery'), part('m', 'dc-motor')], [['bat.+', 'm.1'], ['bat.-', 'board.GND1'], ['m.2', 'board.GND2']]));
  assert.deepEqual([...new Set(grounded.flags.map((flag) => flag.label))].sort(), ['9V', 'GND']);
});

test('a short between rails shows both names', () => {
  const model = layoutDiagram(circuit([part('r1', 'resistor')], [['board.3V', 'board.GND1'], ['r1.1', 'board.3V']]));
  assert.ok(model.flags.some((flag) => flag.label === 'GND/3.3V'));
});

test('a wire to a pin that does not exist is left out', () => {
  const doc = circuit([part('r1', 'resistor')], [['board.D2', 'r1.9'], ['board.D3', 'gone.1'], ['board.D4', 'r1.1']]);
  assert.equal(circuitProblem(doc), null);
  const model = layoutDiagram(doc);
  assert.deepEqual(model.wires.map((item) => item.name), ['D4']);
  assertSound(model, 'missing pin');
});

test('an empty circuit is just the board', () => {
  const model = layoutDiagram(emptyCircuit());
  assert.deepEqual([model.parts.length, model.wires.length, model.flags.length], [1, 0, 0]);
  assertSound(model, 'empty');
  assert.match(renderDiagram(model), /Metro M0 Express/);
});

test('every catalog part can be drawn, wired or not', () => {
  for (const [type, entry] of Object.entries(CATALOG)) {
    if (entry.fixed || entry.background) continue;
    for (const pin of symbolOf(type)?.pins ?? []) assert.ok(entry.pins.some((p) => p.id === pin.id), `${type} has no pin ${pin.id}`);
    const loose = layoutDiagram(circuit([part('p', type)], []));
    assertSound(loose, `${type} alone`);
    const wired = layoutDiagram(circuit([part('p', type)], entry.pins.map((pin, i) => [`p.${pin.id}`, `board.D${i % 14}`])));
    assertSound(wired, `${type} wired`);
    const svg = renderDiagram(wired);
    assert.doesNotMatch(svg, /undefined|NaN/, type);
  }
});

test('text from the file cannot become markup', () => {
  const doc = circuit([part('led1', 'led', 0, 0, { color: '<script>alert(1)</script>' })], []);
  assert.equal(circuitProblem(doc), null);
  assert.doesNotMatch(renderDiagram(layoutDiagram(doc)), /<script/);
});

// Small generator, so a failure can be repeated from its seed.
function random(seed) {
  let state = seed;
  return (limit) => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return Math.floor((state / 2 ** 32) * limit);
  };
}

test('random circuits stay sound', () => {
  const types = Object.keys(CATALOG).filter((type) => !CATALOG[type].fixed && !CATALOG[type].background);
  const board = definition('metro-m0-express').pins;
  for (let seed = 1; seed <= 300; seed++) {
    const next = random(seed);
    const parts = Array.from({ length: 1 + next(9) }, (_, i) => part(`p${i}`, types[next(types.length)]));
    const ends = [...board.map((pin) => `board.${pin.id}`), ...parts.flatMap((p) => definition(p.type).pins.map((pin) => `${p.id}.${pin.id}`))];
    const wires = Array.from({ length: next(24) }, () => [ends[next(ends.length)], ends[next(ends.length)]]);
    assertSound(layoutDiagram(circuit(parts, wires)), `seed ${seed}`);
  }
});
