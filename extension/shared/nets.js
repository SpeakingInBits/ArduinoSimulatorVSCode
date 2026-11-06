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
