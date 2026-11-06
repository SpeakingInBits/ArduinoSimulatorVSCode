// Edits to the circuit document. These hold no page state, so they can be tested without a browser.
import { definition, partBounds, pinPosition } from '../shared/catalog.js';

const GRID = 10;
const MAX_VALUE = 1e9;

const snapTo = (value, step) => Math.round(value / step) * step;
const clone = (value) => JSON.parse(JSON.stringify(value));
const turn = (degrees) => ((degrees % 360) + 360) % 360;

// Reads a typed component value. Resistance can be "4700", "4.7k", "4k7" or "1M". Returns null if
// the text is not a usable value.
export function parseValue(text, unit) {
  const trimmed = String(text).trim().replace(/\s*(ohms?|Ω|[uµ]F)$/i, '');
  if (unit !== 'ohm') {
    const number = /^\d*\.?\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    return number > 0 && number <= MAX_VALUE ? number : null;
  }
  const match = /^(\d*\.?\d+)\s*([kKmM]?)(\d*)$/.exec(trimmed);
  if (!match) return null;
  const [, whole, prefix, fraction] = match;
  if (fraction && (!prefix || whole.includes('.'))) return null;
  const scale = { k: 1e3, m: 1e6 }[prefix.toLowerCase()] ?? 1;
  const value = Math.round(Number(`${whole}${fraction ? `.${fraction}` : ''}`) * scale * 1e6) / 1e6;
  return value > 0 && value <= MAX_VALUE ? value : null;
}

function wireEnd(doc, end) {
  const part = doc.parts.find((p) => p.id === end.part);
  const pinDef = part && definition(part.type).pins.find((p) => p.id === end.pin);
  return pinDef ? pinPosition(part, pinDef) : null;
}

// Every point a wire passes through, or null if one of its ends is missing.
export function wirePoints(doc, wire) {
  const start = wireEnd(doc, wire.from);
  const end = wireEnd(doc, wire.to);
  return start && end ? [start, ...(wire.points ?? []), end] : null;
}

export function wirePath(doc, wire) {
  return wirePoints(doc, wire)?.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') ?? null;
}

// Wires with both ends on the given parts. These move with the parts as a whole.
export function internalWires(doc, parts) {
  const ids = new Set(parts.map((part) => part.id));
  return doc.wires.filter((wire) => ids.has(wire.from.part) && ids.has(wire.to.part));
}

// The parts and the wires between them, ready to paste. The board stays behind, as a circuit only
// has one.
export function copyParts(doc, parts) {
  const copied = parts.filter((part) => !definition(part.type).fixed);
  return copied.length > 0 ? clone({ parts: copied, wires: internalWires(doc, copied) }) : null;
}

// Adds a copy of the clipboard to the circuit and returns what to select. `makeId` gives an id that
// is free in the document.
export function pasteClip(doc, clip, offset, makeId) {
  const ids = new Map();
  const added = [];
  for (const source of clone(clip.parts)) {
    const id = makeId(source.type.replace(/[^a-z]/g, ''));
    ids.set(source.id, id);
    doc.parts.push({ ...source, id, x: source.x + offset, y: source.y + offset });
    added.push({ kind: 'part', id });
  }
  for (const source of clone(clip.wires)) {
    const id = makeId('wire');
    doc.wires.push({
      ...source,
      id,
      from: { ...source.from, part: ids.get(source.from.part) },
      to: { ...source.to, part: ids.get(source.to.part) },
      points: (source.points ?? []).map((p) => ({ x: p.x + offset, y: p.y + offset })),
    });
    added.push({ kind: 'wire', id });
  }
  return added;
}

export function moveParts(doc, parts, dx, dy) {
  for (const part of parts) {
    part.x += dx;
    part.y += dy;
  }
  for (const wire of internalWires(doc, parts)) wire.points = (wire.points ?? []).map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

function groupBox(parts) {
  const boxes = parts.map(partBounds);
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { left, right, top, bottom, center: (left + right) / 2, middle: (top + bottom) / 2 };
}

// Turns one part where it stands, or several as a block around their middle. Notes keep reading
// the right way up.
export function rotateParts(doc, parts) {
  const spin = (part) => {
    if (!definition(part.type).annotation) part.rotation = turn((part.rotation ?? 0) + 90);
  };
  if (parts.length === 1) {
    spin(parts[0]);
    return;
  }
  const box = groupBox(parts);
  const px = snapTo(box.center, GRID);
  const py = snapTo(box.middle, GRID);
  const around = (point) => ({ x: px - (point.y - py), y: py + (point.x - px) });
  for (const part of parts) {
    Object.assign(part, around(part));
    spin(part);
  }
  for (const wire of internalWires(doc, parts)) wire.points = (wire.points ?? []).map(around);
}

// Mirrors parts left to right. Reflecting about a multiple of 5 keeps everything on the grid.
export function flipParts(doc, parts) {
  const axis = snapTo(groupBox(parts).center, GRID / 2);
  for (const part of parts) {
    part.x = 2 * axis - part.x;
    if (definition(part.type).annotation) {
      part.x -= partBounds(part).w - 12;
      continue;
    }
    part.flip = !part.flip;
    part.rotation = turn(-(part.rotation ?? 0));
  }
  for (const wire of internalWires(doc, parts)) wire.points = (wire.points ?? []).map((p) => ({ x: 2 * axis - p.x, y: p.y }));
}

// Lines parts up with the edge or middle of the area they cover together.
export function alignParts(parts, edge) {
  const box = groupBox(parts);
  for (const part of parts) {
    const own = partBounds(part);
    const delta = {
      left: box.left - own.x,
      right: box.right - (own.x + own.w),
      center: box.center - (own.x + own.w / 2),
      top: box.top - own.y,
      bottom: box.bottom - (own.y + own.h),
      middle: box.middle - (own.y + own.h / 2),
    }[edge];
    if (['left', 'right', 'center'].includes(edge)) part.x += snapTo(delta, GRID);
    else part.y += snapTo(delta, GRID);
  }
}
