// Works out which pins are electrically joined: by wires, by a part's internal connections
// (breadboard rows, the two sides of a button), and by a pin sitting in a breadboard hole.
import { definition, pinPosition } from './catalog.js';

export const pinKey = (part, pin) => `${part}:${pin}`;

class DisjointSets {
  constructor() {
    this.parent = new Map();
  }

  find(item) {
    if (!this.parent.has(item)) this.parent.set(item, item);
    let root = item;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let current = item;
    while (this.parent.get(current) !== root) {
      const next = this.parent.get(current);
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a, b) {
    this.parent.set(this.find(a), this.find(b));
  }
}

export function buildNets(circuit) {
  const sets = new DisjointSets();
  const byPosition = new Map();
  const realPins = new Set();

  for (const part of circuit.parts) {
    const entry = definition(part.type);
    for (const pinDef of entry.pins) {
      const key = pinKey(part.id, pinDef.id);
      sets.find(key);
      if (!entry.background) realPins.add(key);
      const { x, y } = pinPosition(part, pinDef);
      const spot = `${x},${y}`;
      if (byPosition.has(spot)) sets.union(key, byPosition.get(spot));
      else byPosition.set(spot, key);
    }
    for (const group of entry.groups ?? []) {
      for (let i = 1; i < group.length; i++) sets.union(pinKey(part.id, group[0]), pinKey(part.id, group[i]));
    }
  }

  for (const wire of circuit.wires) {
    const from = pinKey(wire.from.part, wire.from.pin);
    const to = pinKey(wire.to.part, wire.to.pin);
    if (sets.parent.has(from) && sets.parent.has(to)) sets.union(from, to);
  }

  // Only nets that reach a real part matter. Empty breadboard rows are dropped.
  const netIds = new Map();
  const netOf = new Map();
  for (const key of realPins) {
    const root = sets.find(key);
    if (!netIds.has(root)) netIds.set(root, netIds.size);
    netOf.set(key, netIds.get(root));
  }
  for (const wire of circuit.wires) {
    for (const end of [wire.from, wire.to]) {
      const key = pinKey(end.part, end.pin);
      if (!sets.parent.has(key)) continue;
      const root = sets.find(key);
      if (!netIds.has(root)) netIds.set(root, netIds.size);
      netOf.set(key, netIds.get(root));
    }
  }
  return { netOf, netCount: netIds.size, sameNet: (a, b) => sets.find(a) === sets.find(b), find: (key) => sets.find(key) };
}

// What the running simulation leaves out: parts and wires with no connection to the board or a
// battery. Nothing can reach them, so they stay as they are however the program runs.
export function unsimulated(doc) {
  const { netOf } = buildNets(doc);
  const placed = doc.parts.filter((part) => {
    const entry = definition(part.type);
    return !entry.background && !entry.annotation;
  });
  const netsOf = new Map(placed.map((part) => [part, definition(part.type).pins.map((pinDef) => netOf.get(pinKey(part.id, pinDef.id)))]));
  const partsOn = new Map();
  for (const [part, nets] of netsOf) {
    for (const net of nets) {
      if (!partsOn.has(net)) partsOn.set(net, []);
      partsOn.get(net).push(part);
    }
  }
  const reached = new Set(placed.filter((part) => definition(part.type).powers));
  const liveNets = new Set();
  const queue = [...reached];
  while (queue.length > 0) {
    for (const net of netsOf.get(queue.pop())) {
      if (liveNets.has(net)) continue;
      liveNets.add(net);
      for (const part of partsOn.get(net)) {
        if (reached.has(part)) continue;
        reached.add(part);
        queue.push(part);
      }
    }
  }
  return {
    parts: new Set(placed.filter((part) => !reached.has(part)).map((part) => part.id)),
    wires: new Set(doc.wires.filter((wire) => !liveNets.has(netOf.get(pinKey(wire.from.part, wire.from.pin))))),
  };
}
