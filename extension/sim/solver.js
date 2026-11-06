// DC circuit solver using nodal analysis. Everything is expressed as conductances and current
// sources, and nonlinear parts (diodes, transistors) use piecewise-linear states that are
// iterated until they stop changing.
//
// Node 0 is ground, nodes 1 and up are unknown, and negative nodes are fixed supply rails:
// node -1 is rails[0], node -2 is rails[1], and so on. Treating rails as known voltages lets
// the circuit split into small independent groups, which keeps each solve fast.

const GMIN = 1e-10; // Keeps floating nodes solvable. Equivalent to 10 gigaohms to ground.
const MAX_ITERATIONS = 40;

export class Solver {
  constructor(nodeCount, rails = []) {
    this.nodeCount = nodeCount;
    this.size = nodeCount - 1;
    this.rails = rails;
    this.elements = [];
    this.voltages = new Float64Array(nodeCount);
    this.matrix = new Float64Array(this.size * this.size);
    this.rhs = new Float64Array(this.size);
  }

  add(element) {
    this.elements.push(element);
    return element;
  }

  resistor(a, b, ohms) {
    return this.add({ kind: 'resistor', a, b, ohms });
  }

  // A voltage source with internal resistance. Set `off` to remove it from the circuit.
  source(a, b, volts, ohms = 0.01) {
    return this.add({ kind: 'source', a, b, volts, ohms, off: false });
  }

  switch(a, b, closed = false, ohms = 0.01) {
    return this.add({ kind: 'switch', a, b, closed, ohms });
  }

  diode(anode, cathode, forwardVolts = 0.7, ohms = 1) {
    return this.add({ kind: 'diode', a: anode, b: cathode, forwardVolts, ohms, on: false, amps: 0 });
  }

  npn(base, collector, emitter, gain = 150) {
    return this.add({ kind: 'npn', base, collector, emitter, gain, state: 'off', baseAmps: 0, collectorAmps: 0 });
  }

  nmos(gate, drain, source, thresholdVolts = 2, onOhms = 0.5) {
    return this.add({ kind: 'nmos', gate, drain, source, thresholdVolts, onOhms, on: false });
  }

  v(node) {
    return node < 0 ? this.rails[-node - 1] : this.voltages[node];
  }

  stampConductance(a, b, g) {
    const n = this.size;
    if (a > 0) this.matrix[(a - 1) * n + (a - 1)] += g;
    if (b > 0) this.matrix[(b - 1) * n + (b - 1)] += g;
    if (a > 0 && b > 0) {
      this.matrix[(a - 1) * n + (b - 1)] -= g;
      this.matrix[(b - 1) * n + (a - 1)] -= g;
    }
    // A conductance to a rail feeds a known current into the unknown node.
    if (a < 0 && b > 0) this.rhs[b - 1] += g * this.v(a);
    if (b < 0 && a > 0) this.rhs[a - 1] += g * this.v(b);
  }

  // Current flowing from a to b through the element.
  stampCurrent(a, b, amps) {
    if (a > 0) this.rhs[a - 1] -= amps;
    if (b > 0) this.rhs[b - 1] += amps;
  }

  stamp() {
    this.matrix.fill(0);
    this.rhs.fill(0);
    for (let i = 0; i < this.size; i++) this.matrix[i * this.size + i] = GMIN;
    for (const e of this.elements) {
      switch (e.kind) {
        case 'resistor':
          this.stampConductance(e.a, e.b, 1 / e.ohms);
          break;
        case 'source':
          if (!e.off) {
            this.stampConductance(e.a, e.b, 1 / e.ohms);
            this.stampCurrent(e.b, e.a, e.volts / e.ohms);
          }
          break;
        case 'switch':
          if (e.closed) this.stampConductance(e.a, e.b, 1 / e.ohms);
          break;
        case 'diode':
          if (e.on) {
            this.stampConductance(e.a, e.b, 1 / e.ohms);
            this.stampCurrent(e.b, e.a, e.forwardVolts / e.ohms);
          }
          break;
        case 'npn':
          this.stampNpn(e);
          break;
        case 'nmos':
          if (e.on) this.stampConductance(e.drain, e.source, 1 / e.onOhms);
          break;
        default:
          throw new Error(`Unknown element ${e.kind}`);
      }
    }
  }

  stampNpn(e) {
    if (e.state === 'off') return;
    // Base-emitter junction: 0.7V drop behind a small resistance.
    this.stampConductance(e.base, e.emitter, 1 / NPN_BASE_OHMS);
    this.stampCurrent(e.emitter, e.base, NPN_BASE_VOLTS / NPN_BASE_OHMS);
    if (e.state === 'saturated') {
      this.stampConductance(e.collector, e.emitter, 1 / NPN_SATURATED_OHMS);
    } else {
      // Active: the collector current follows the base current, set from the last iteration.
      this.stampCurrent(e.collector, e.emitter, e.gain * e.baseAmps);
    }
  }

  solveLinear() {
    const n = this.size;
    const a = this.matrix;
    const b = this.rhs;
    for (let col = 0; col < n; col++) {
      let pivotRow = col;
      let largest = Math.abs(a[col * n + col]);
      for (let row = col + 1; row < n; row++) {
        const value = Math.abs(a[row * n + col]);
        if (value > largest) {
          largest = value;
          pivotRow = row;
        }
      }
      if (largest === 0) continue;
      if (pivotRow !== col) {
        for (let k = col; k < n; k++) {
          const held = a[col * n + k];
          a[col * n + k] = a[pivotRow * n + k];
          a[pivotRow * n + k] = held;
        }
        const held = b[col];
        b[col] = b[pivotRow];
        b[pivotRow] = held;
      }
      const pivot = a[col * n + col];
      for (let row = col + 1; row < n; row++) {
        const factor = a[row * n + col] / pivot;
        if (factor === 0) continue;
        for (let k = col; k < n; k++) a[row * n + k] -= factor * a[col * n + k];
        b[row] -= factor * b[col];
      }
    }
    for (let row = n - 1; row >= 0; row--) {
      let sum = b[row];
      for (let k = row + 1; k < n; k++) sum -= a[row * n + k] * b[k];
      const pivot = a[row * n + row];
      b[row] = pivot === 0 ? 0 : sum / pivot;
    }
    this.voltages[0] = 0;
    for (let i = 0; i < n; i++) this.voltages[i + 1] = b[i];
  }

  // Updates nonlinear states from the latest voltages. Returns true if any state changed.
  updateStates() {
    let changed = false;
    for (const e of this.elements) {
      if (e.kind === 'diode') {
        const drop = this.v(e.a) - this.v(e.b);
        const on = e.on ? (drop - e.forwardVolts) / e.ohms > 0 : drop > e.forwardVolts;
        if (on !== e.on) {
          e.on = on;
          changed = true;
        }
        e.amps = on ? (drop - e.forwardVolts) / e.ohms : 0;
      } else if (e.kind === 'nmos') {
        const on = this.v(e.gate) - this.v(e.source) >= e.thresholdVolts;
        if (on !== e.on) {
          e.on = on;
          changed = true;
        }
      } else if (e.kind === 'npn') {
        changed = this.updateNpn(e) || changed;
      }
    }
    return changed;
  }

  updateNpn(e) {
    const baseEmitter = this.v(e.base) - this.v(e.emitter);
    const collectorEmitter = this.v(e.collector) - this.v(e.emitter);
    const previous = e.state;
    const previousBase = e.baseAmps;
    if (e.state === 'off') {
      if (baseEmitter > NPN_BASE_VOLTS) e.state = 'saturated';
      e.baseAmps = 0;
      e.collectorAmps = 0;
    } else {
      e.baseAmps = Math.max(0, (baseEmitter - NPN_BASE_VOLTS) / NPN_BASE_OHMS);
      if (e.baseAmps <= 1e-9) {
        e.state = 'off';
        e.collectorAmps = 0;
      } else if (e.state === 'saturated') {
        e.collectorAmps = collectorEmitter / NPN_SATURATED_OHMS;
        if (e.collectorAmps > e.gain * e.baseAmps) e.state = 'active';
      } else {
        e.collectorAmps = e.gain * e.baseAmps;
        if (collectorEmitter < NPN_SATURATION_VOLTS) e.state = 'saturated';
      }
    }
    return e.state !== previous || Math.abs(e.baseAmps - previousBase) > 1e-7;
  }

  // Solves the circuit. Returns false if nonlinear states never settled.
  solve() {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      this.stamp();
      this.solveLinear();
      if (!this.updateStates()) return true;
    }
    return false;
  }

  // Current from a to b through a resistor, source, or closed switch.
  currentThrough(e) {
    const drop = this.v(e.a) - this.v(e.b);
    switch (e.kind) {
      case 'resistor':
        return drop / e.ohms;
      case 'source':
        return e.off ? 0 : (drop - e.volts) / e.ohms;
      case 'switch':
        return e.closed ? drop / e.ohms : 0;
      case 'diode':
        return e.amps;
      default:
        return 0;
    }
  }
}

const NPN_BASE_VOLTS = 0.7;
const NPN_BASE_OHMS = 10;
const NPN_SATURATED_OHMS = 2;
const NPN_SATURATION_VOLTS = 0.2;
