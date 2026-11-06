// Schematic symbols, and the SVG for a laid-out diagram. Unlike art.js these use the theme's
// colors, because a schematic shows how a circuit is joined rather than what its parts look like.
import { definition } from '../shared/catalog.js';
import { LED_HEX } from './art.js';

const path = (d) => `<path d="${d}"/>`;
const dot = (x, y) => `<circle class="d-solid" cx="${x}" cy="${y}" r="1.8"/>`;

const RESISTOR = 'M0 0H12l3-7 6 14 6-14 6 14 6-14 6 14 3-7H60';
const DIODE = 'M0 0H20M20-10L40 0L20 10ZM40-10V10M40 0H60';
const ARROWS = 'M30-12l8-8m-5 1l5-1l-1 5M40-10l8-8m-5 1l5-1l-1 5';

const twoLeads = (first, second, draw) => ({
  w: 60,
  up: 40,
  down: 30,
  pins: [{ id: first, side: 'L', y: 0 }, { id: second, side: 'R', y: 0 }],
  draw,
});

const threeLeads = (w, pins, draw) => ({ w, up: 40, down: 40, pins, draw });
const sides = (L, R) => [...L.map(([id, y]) => ({ id, side: 'L', y })), ...R.map(([id, y]) => ({ id, side: 'R', y }))];

// Pin `y` is measured from the symbol's middle. A part with two pins joined inside it, such as
// a push button, lists one of each pair. Anything not listed is drawn as a labelled block, so a
// new part needs nothing added here.
const SYMBOLS = {
  resistor: twoLeads('1', '2', () => path(RESISTOR)),
  photoresistor: twoLeads('1', '2', () => path(RESISTOR) + path('M18-20l6 7m-5-2l5 2l-1-5M30-20l6 7m-5-2l5 2l-1-5')),
  thermistor: twoLeads('1', '2', () => path(RESISTOR) + path('M14 12L46-12H52')),
  fsr: twoLeads('1', '2', () => path(RESISTOR) + path('M30-22V-12m-4-4l4 4l4-4')),
  capacitor: twoLeads('+', '-', () => path('M0 0H26M26-12V12M34-12V12M34 0H60M14-10h6m-3-3v6')),
  diode: twoLeads('A', 'K', () => path(DIODE)),
  led: twoLeads('A', 'K', (part) => `<path class="d-tint" fill="${LED_HEX[part.props?.color] ?? 'none'}" d="M20-10L40 0L20 10Z"/>${path(DIODE)}${path(ARROWS)}`),
  button: twoLeads('1a', '2a', () => path('M0 0H16M44 0H60M14-8H46M30-8V-16M24-16H36') + dot(18, 0) + dot(42, 0)),
  'tilt-switch': twoLeads('1', '2', () => path('M0 0H18L40-12M44 0H60') + dot(18, 0) + dot(42, 0)),
  piezo: twoLeads('+', '-', () => path('M0 0H18M42 0H60M18-12H42V12H18ZM24-17a8 8 0 0 1 12 0M21-21a12 12 0 0 1 18 0')),
  'dc-motor': twoLeads('1', '2', () => '<circle cx="30" cy="0" r="14"/>' + path('M0 0H16M44 0H60M23 7V-7L30 3L37-7V7')),
  battery: twoLeads('+', '-', () => path('M0 0H22M22-14V14M28-7V7M34-14V14M40-7V7M40 0H60M10-11h6m-3-3v6')),

  potentiometer: threeLeads(50, sides([['1', -20], ['2', 20]], [['W', 0]]),
    () => path('M0-20H20V-14l-6 3 12 5-12 5 12 5-12 5 6 3V20H0M50 0H32m6-5l-6 5l6 5')),
  'slide-switch': threeLeads(60, sides([['COM', 0]], [['1', -20], ['2', 20]]),
    () => path('M0 0H16L40-16M44-20H60M44 20H60') + dot(18, 0) + dot(42, -20) + dot(42, 20)),
  npn: threeLeads(50, sides([['B', 0]], [['C', -20], ['E', 20]]),
    () => '<circle cx="26" cy="0" r="17"/>' + path('M0 0H18M18-11V11M18-5L36-20H50M18 5L36 20H50M31 11l5 9l-10-2')),
  nmos: threeLeads(50, sides([['G', 0]], [['D', -20], ['S', 20]]),
    () => '<circle cx="26" cy="0" r="17"/>' + path('M0 0H16M16-10V10M21-12V-5M21-3V3M21 5V12M21-9H36V-20H50M21 9H36V20H50M21 0H36V9M27-4l-6 4l6 4')),
};

export const symbolOf = (type) => SYMBOLS[type];

const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function formatProp(value, unit) {
  if (unit === 'ohm') return value >= 1e6 ? `${value / 1e6} MΩ` : value >= 1000 ? `${value / 1000} kΩ` : `${value} Ω`;
  if (unit === 'uF') return `${value} µF`;
  return unit ? `${value} ${unit}` : `${value}`;
}

// What sets this part apart from another of its type, such as "220 Ω" or "green".
export function partValue(part) {
  const specs = Object.entries(definition(part.type).props ?? {});
  return specs.filter(([key]) => part.props?.[key] !== undefined).map(([key, spec]) => formatProp(part.props[key], spec.unit)).join(', ');
}

const label = (x, y, text, anchor = 'middle', style = '') => `<text class="d-text ${style}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(text)}</text>`;

function drawSymbol(item) {
  const symbol = symbolOf(item.type);
  const middle = item.y + symbol.up;
  const place = item.flipped ? `translate(${item.x + symbol.w} ${middle}) scale(-1 1)` : `translate(${item.x} ${middle})`;
  const center = item.x + item.w / 2;
  return `<g class="d-line" transform="${place}">${symbol.draw(item)}</g>${label(center, item.y + 10, item.id, 'middle', 'd-name')}${item.value ? label(center, item.y + item.h - 4, item.value, 'middle', 'd-muted') : ''}`;
}

function drawBlock(item) {
  const center = item.x + item.w / 2;
  const subtitle = [item.id, item.value].filter(Boolean).join(', ');
  let html = `<rect class="d-body" x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="3"/>`;
  html += label(center, item.y + 15, item.name, 'middle', 'd-name') + label(center, item.y + 28, subtitle, 'middle', 'd-muted');
  for (const pin of item.pins) {
    html += pin.side === 'L' ? label(pin.x + 6, pin.y + 3.5, pin.label, 'start', 'd-pin') : label(pin.x - 6, pin.y + 3.5, pin.label, 'end', 'd-pin');
  }
  return html;
}

function drawWire(wire) {
  const d = wire.segments.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('');
  const joins = wire.junctions.map(([x, y]) => `<circle class="d-solid" cx="${x}" cy="${y}" r="2.6"/>`).join('');
  return `<g class="d-net" data-net="${wire.net}"><title>${esc(wire.name)}</title><path class="d-hit" d="${d}"/><path class="d-wire" d="${d}"/>${joins}</g>`;
}

export const FLAG_LEAD = 14;

// Power and ground are marked at each pin, as on a printed schematic, rather than drawn as wires
// across the whole page.
function drawFlag(flag) {
  const way = flag.side === 'L' ? -1 : 1;
  const end = flag.x + way * FLAG_LEAD;
  const { y } = flag;
  const lead = `M${flag.x} ${y}H${end}`;
  const shape = flag.kind === 'ground'
    ? `${lead}V${y + 4}M${end - 7} ${y + 4}h14M${end - 4.5} ${y + 8}h9M${end - 2} ${y + 12}h4`
    : `${lead}M${end} ${y - 5}V${y + 5}`;
  const text = flag.kind === 'ground' ? '' : label(end + way * 4, y + 3.5, flag.label, flag.side === 'L' ? 'end' : 'start', 'd-pin');
  return `<g class="d-net" data-net="${flag.net}"><title>${esc(flag.label)}</title><path class="d-wire" d="${shape}"/>${text}</g>`;
}

// The inside of the diagram's SVG, in the layout's coordinates.
export function renderDiagram(model) {
  const parts = model.parts.map((item) => `<g class="d-part" data-part="${esc(item.id)}"><title>${esc(item.name)}</title>${item.symbol ? drawSymbol(item) : drawBlock(item)}</g>`);
  return `${model.wires.map(drawWire).join('')}${model.flags.map(drawFlag).join('')}${parts.join('')}`;
}
