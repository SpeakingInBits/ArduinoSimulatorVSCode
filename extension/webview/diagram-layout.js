// Works out a circuit diagram from circuit.json. This is only geometry, so it can be tested
// without a browser.
//
// The board sits in the first column, and each part sits one column further out than the part
// that feeds it. Wires run in channels between columns, and a net that has to skip a column
// passes through a gap kept for it there. Nothing but a net's own pins share a row in a channel,
// so wires only ever cross, and never run along each other or end on a wire they aren't part of.
import { definition } from '../shared/catalog.js';
import { buildNets, pinKey } from '../shared/nets.js';
import { FLAG_LEAD, partValue, symbolOf } from './diagram-art.js';

const GRID = 10;
const MARGIN = 20;
const PIN_PITCH = 20;
const ITEM_GAP = 20;
const CHAR = 6.2; // Rough width of one character, since this runs without a browser to measure text.
const BLOCK_HEAD = 40;
const BLOCK_FOOT = 20;
const MIN_CHANNEL = 30;
const GROUND_WIDTH = FLAG_LEAD + 10;

const RAILS = { '3V': '3.3V', IOREF: '3.3V', '5V': '5V', VIN: 'VIN' };
const GROUND = /^GND\d?$/;

const isBoard = (entry) => entry.category === 'Boards' && !entry.background;
const snap = (value) => Math.ceil(value / GRID) * GRID;
const textWidth = (text) => text.length * CHAR;

// Rails are the nets a board or battery powers. They show as a symbol at each pin, not as wires.
function noteRail(net, entry, part, pinId) {
  if (isBoard(entry)) {
    if (GROUND.test(pinId)) net.ground = true;
    else if (RAILS[pinId]) net.rails.add(RAILS[pinId]);
  } else if (part.type === 'battery') {
    if (pinId === '+') net.rails.add(`${part.props?.volts ?? ''}V`);
    else net.batteryMinus = true;
  }
}

function classify(net) {
  if (net.batteryMinus && !net.ground) net.rails.add('BAT-');
  const names = [...(net.ground ? ['GND'] : []), ...net.rails];
  net.label = names.join('/');
  if (names.length === 0) net.kind = 'signal';
  else net.kind = net.ground && net.rails.size === 0 ? 'ground' : 'power';
}

// Digital pins, then analog, then the rest, then power, so the board reads in a familiar order.
function boardRank(pin, index) {
  const match = /^([DA])(\d+)$/.exec(pin.id);
  if (pin.net.kind !== 'signal') return [pin.net.kind === 'power' ? 3 : 4, index];
  return match ? [match[1] === 'D' ? 0 : 1, Number(match[2])] : [2, index];
}

function boardPins(item, entry) {
  const shownRails = new Set();
  const pins = [];
  entry.pins.forEach((pinDef, index) => {
    const net = item.netAt(pinDef.id);
    if (net.kind === 'signal') {
      if (net.real.length < 2) return;
    } else {
      // The board's GND pins are one net, so one of them is enough.
      if (shownRails.has(net) || !net.real.some((end) => end.part !== item.part)) return;
      shownRails.add(net);
    }
    pins.push({ id: pinDef.id, label: pinDef.label, net, side: 'R', rank: boardRank({ id: pinDef.id, net }, index) });
  });
  return pins.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
}

function connect(doc) {
  const { find } = buildNets(doc);
  const nets = new Map();
  const netAt = (part, pinId) => {
    const root = find(pinKey(part.id, pinId));
    if (!nets.has(root)) nets.set(root, { id: nets.size, rails: new Set(), real: [], ends: [] });
    return nets.get(root);
  };

  const items = doc.parts.filter((part) => !definition(part.type).background).map((part) => {
    const entry = definition(part.type);
    for (const pinDef of entry.pins) {
      const net = netAt(part, pinDef.id);
      net.real.push({ part, pin: pinDef.id });
      noteRail(net, entry, part, pinDef.id);
    }
    return { part, entry, type: part.type, id: part.id, name: entry.name, value: partValue(part), netAt: (pinId) => netAt(part, pinId) };
  });
  nets.forEach(classify);

  const board = items.find((item) => isBoard(item.entry));
  for (const item of items) {
    const symbol = symbolOf(item.type);
    item.symbol = !!symbol;
    if (item === board) item.pins = boardPins(item, item.entry);
    else if (symbol) item.pins = symbol.pins.map((pin) => ({ ...pin, net: item.netAt(pin.id) }));
    else item.pins = item.entry.pins.map((pinDef) => ({ id: pinDef.id, label: pinDef.label, net: item.netAt(pinDef.id) }));
    for (const pin of item.pins) {
      pin.item = item;
      pin.net.ends.push(pin);
    }
  }
  for (const net of nets.values()) {
    const first = net.real.find((end) => end.part === board.part) ?? net.real[0];
    net.name = net.label || (first.part === board.part ? first.pin : `${first.part.id} pin ${first.pin}`);
  }
  return { board, items, nets: [...nets.values()] };
}

const isWired = (pin) => pin.net.kind === 'signal' && pin.net.ends.length > 1;

function assignColumns({ board, items }) {
  const spread = (start) => {
    const queue = [start];
    while (queue.length) {
      const item = queue.shift();
      for (const pin of item.pins.filter(isWired)) {
        for (const end of pin.net.ends) {
          if (end.item.column !== undefined) continue;
          end.item.column = item.column + 1;
          queue.push(end.item);
        }
      }
    }
  };
  board.column = 0;
  spread(board);
  // Parts that only meet the board through power start from whichever end is fed.
  const feeds = (item) => (item.pins.some((pin) => pin.net.kind === 'power') ? 0 : 1);
  for (const item of items.filter((i) => i.column === undefined).sort((a, b) => feeds(a) - feeds(b))) {
    if (item.column !== undefined) continue;
    item.column = 1;
    spread(item);
  }
}

// The side of a part a pin should leave from, or null if it does not matter.
function wantedSide(pin) {
  if (!isWired(pin)) return null;
  const columns = pin.net.ends.filter((end) => end.item !== pin.item).map((end) => end.item.column);
  if (columns.length === 0) return null;
  return Math.min(...columns) < pin.item.column ? 'L' : 'R';
}

const otherSide = (side) => (side === 'L' ? 'R' : 'L');

function shapeSymbol(item) {
  const symbol = symbolOf(item.type);
  const matches = (flip) => item.pins.filter((pin) => wantedSide(pin) === (flip ? otherSide(pin.side) : pin.side)).length;
  item.flipped = matches(true) > matches(false);
  for (const pin of item.pins) {
    if (item.flipped) pin.side = otherSide(pin.side);
    pin.dy = symbol.up + pin.y;
    delete pin.y;
  }
  item.w = symbol.w;
  item.h = symbol.up + symbol.down;
  item.labelWidth = Math.max(textWidth(item.id), textWidth(item.value));
}

function shapeBlock(item) {
  const count = { L: 0, R: 0 };
  const widest = { L: 0, R: 0 };
  for (const pin of item.pins) {
    pin.side ??= wantedSide(pin) ?? 'R';
    pin.dy = BLOCK_HEAD + count[pin.side]++ * PIN_PITCH;
    widest[pin.side] = Math.max(widest[pin.side], textWidth(pin.label));
  }
  const title = Math.max(textWidth(item.name), textWidth(`${item.id}, ${item.value}`));
  item.w = snap(Math.max(title + 16, widest.L + widest.R + 28));
  item.h = BLOCK_HEAD + (Math.max(count.L, count.R, 1) - 1) * PIN_PITCH + BLOCK_FOOT;
  item.labelWidth = 0;
}

// Where a net meets a side of a column. A gap kept for a passing net meets both sides.
const leftEnds = (item) => (item.feed ? [{ net: item.feed, dy: 0 }] : item.pins.filter((pin) => isWired(pin) && pin.side === 'L'));
const rightEnds = (item) => (item.feed ? [{ net: item.feed, dy: 0 }] : item.pins.filter((pin) => isWired(pin) && pin.side === 'R'));

function buildColumns({ items, nets }) {
  const columns = Array.from({ length: Math.max(...items.map((item) => item.column)) + 1 }, () => []);
  for (const item of items) columns[item.column].push(item);
  for (const net of nets) {
    const wired = net.ends.filter(isWired);
    if (wired.length === 0) continue;
    const channels = wired.map((pin) => pin.item.column + (pin.side === 'R' ? 1 : 0));
    for (let column = Math.min(...channels); column < Math.max(...channels); column++) {
      columns[column].push({ feed: net, h: 0, pins: [] });
    }
  }
  return columns;
}

// Puts each column in the order of what it connects to on its left, which keeps wires from crossing.
function orderColumns(columns) {
  let rank = new Map(columns[0][0].pins.map((pin, index) => [pin.net, index]));
  for (const column of columns.slice(1)) {
    const key = (item) => {
      const known = leftEnds(item).map((end) => rank.get(end.net)).filter((value) => value !== undefined);
      return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : Infinity;
    };
    const keys = new Map(column.map((item) => [item, key(item)]));
    column.sort((a, b) => (keys.get(a) === keys.get(b) ? 0 : keys.get(a) - keys.get(b)));
    rank = new Map();
    column.forEach((item, index) => {
      for (const end of rightEnds(item)) rank.set(end.net, index);
    });
  }
}

// Rows in a column's right edge that hold a wire, so the next column can line up with them.
function rowsOf(column) {
  const rows = new Map();
  for (const item of column) {
    for (const end of rightEnds(item)) rows.set(item.y + end.dy, end.net);
  }
  return rows;
}

function placeColumn(column, rowsOnLeft) {
  let cursor = 0;
  for (const item of column) {
    const aligned = leftEnds(item).map((end) => {
      const row = [...rowsOnLeft].find(([, net]) => net === end.net);
      return row ? row[0] - end.dy : undefined;
    }).find((top) => top !== undefined);
    let top = snap(Math.max(cursor, aligned ?? cursor));
    const clashes = () => leftEnds(item).some((end) => rowsOnLeft.has(top + end.dy) && rowsOnLeft.get(top + end.dy) !== end.net);
    while (clashes()) top += GRID;
    item.y = top;
    cursor = top + item.h + ITEM_GAP;
  }
}

// The board goes last, because its pins line up with whatever they connect to.
function placeBoard(board, firstColumn) {
  const rows = new Map();
  for (const item of firstColumn) {
    for (const end of leftEnds(item)) rows.set(item.y + end.dy, end.net);
  }
  let cursor = 0;
  for (const pin of board.pins) {
    const row = [...rows].find(([, net]) => net === pin.net);
    let y = snap(Math.max(cursor, row ? row[0] : cursor));
    while (rows.has(y) && rows.get(y) !== pin.net) y += GRID;
    pin.row = y;
    cursor = y + PIN_PITCH;
  }
  const first = board.pins[0]?.row ?? 0;
  board.y = first - BLOCK_HEAD;
  for (const pin of board.pins) {
    pin.dy = pin.row - board.y;
    delete pin.row;
  }
  board.h = (board.pins.at(-1)?.dy ?? BLOCK_HEAD) + BLOCK_FOOT;
}

const flagWidth = (net) => (net.kind === 'ground' ? GROUND_WIDTH : FLAG_LEAD + 6 + textWidth(net.label));

function sizeColumn(column) {
  const parts = column.filter((item) => !item.feed);
  const padding = (side) => Math.max(0, ...parts.flatMap((item) => item.pins)
    .filter((pin) => pin.side === side && pin.net.kind !== 'signal')
    .map((pin) => flagWidth(pin.net)));
  const body = Math.max(0, ...parts.map((item) => Math.max(item.w, item.labelWidth)));
  const left = snap(padding('L'));
  return { left, body: snap(body), width: left + snap(body) + snap(padding('R')) };
}

// Gives each net in a channel its own vertical track, reusing a track once the last net on it ends.
function assignTracks(runs) {
  const tracks = [];
  for (const run of [...runs].sort((a, b) => a.low - b.low)) {
    let track = tracks.findIndex((bottom) => bottom < run.low);
    if (track < 0) track = tracks.length;
    tracks[track] = run.high;
    run.track = track;
  }
  return tracks.length;
}

function channelRuns(columns, count) {
  const channels = Array.from({ length: count }, () => new Map());
  const add = (channel, net, side, y) => {
    if (!channels[channel].has(net)) channels[channel].set(net, { net, left: [], right: [] });
    channels[channel].get(net)[side].push(y);
  };
  columns.forEach((column, index) => {
    for (const item of column) {
      for (const end of leftEnds(item)) add(index, end.net, 'right', item.y + end.dy);
      for (const end of rightEnds(item)) add(index + 1, end.net, 'left', item.y + end.dy);
    }
  });
  return channels.map((runs) => {
    const list = [...runs.values()];
    for (const run of list) {
      const rows = [...run.left, ...run.right];
      run.low = Math.min(...rows);
      run.high = Math.max(...rows);
    }
    const bent = list.filter((run) => run.low !== run.high);
    return { runs: list, tracks: assignTracks(bent) };
  });
}

function drawChannel(channel, left, right, wireOf) {
  const trackX = (track) => left + (track + 1) * GRID;
  for (const run of channel.runs) {
    const wire = wireOf(run.net);
    if (run.low === run.high) {
      if (run.left.length && run.right.length) wire.segments.push([left, run.low, right, run.low]);
      continue;
    }
    const x = trackX(run.track);
    wire.segments.push([x, run.low, x, run.high]);
    for (const y of run.left) wire.segments.push([left, y, x, y]);
    for (const y of run.right) wire.segments.push([x, y, right, y]);
    for (const y of new Set([...run.left, ...run.right])) {
      const arms = [y > run.low, y < run.high, run.left.includes(y), run.right.includes(y)].filter(Boolean).length;
      if (arms >= 3) wire.junctions.push([x, y]);
    }
  }
}

function route(columns, { items, nets }) {
  const shift = MARGIN - Math.min(0, ...items.map((item) => item.y));
  for (const column of columns) {
    for (const item of column) item.y += shift;
  }

  const sizes = columns.map(sizeColumn);
  const channels = channelRuns(columns, columns.length + 1);
  const channelWidth = (channel) => (channel.tracks ? (channel.tracks + 1) * GRID : MIN_CHANNEL);

  const wires = new Map();
  const wireOf = (net) => {
    if (!wires.has(net)) wires.set(net, { net: net.id, name: net.name, segments: [], junctions: [] });
    return wires.get(net);
  };

  const flags = [];
  let x = MARGIN;
  const edges = columns.map((column, index) => {
    if (index > 0) x += channelWidth(channels[index]);
    const edge = { left: x, right: x + sizes[index].width };
    x = edge.right;
    return edge;
  });

  columns.forEach((column, index) => {
    const { left, right } = edges[index];
    const size = sizes[index];
    for (const item of column) {
      if (item.feed) {
        wireOf(item.feed).segments.push([left, item.y, right, item.y]);
        continue;
      }
      item.x = left + size.left + Math.floor((size.body - item.w) / 2 / GRID) * GRID;
      for (const pin of item.pins) {
        pin.x = item.x + (pin.side === 'R' ? item.w : 0);
        pin.y = item.y + pin.dy;
        if (isWired(pin)) {
          const edge = pin.side === 'L' ? left : right;
          if (edge !== pin.x) wireOf(pin.net).segments.push([Math.min(edge, pin.x), pin.y, Math.max(edge, pin.x), pin.y]);
        } else if (pin.net.kind !== 'signal') {
          flags.push({ x: pin.x, y: pin.y, side: pin.side, kind: pin.net.kind, label: pin.net.label, net: pin.net.id });
        }
      }
    }
  });

  channels.forEach((channel, index) => {
    if (index === 0) return;
    const left = edges[index - 1].right;
    const right = index < columns.length ? edges[index].left : left + channelWidth(channel);
    drawChannel(channel, left, right, wireOf);
  });

  const lastChannel = channels[columns.length];
  const height = Math.max(...items.map((item) => item.y + item.h));
  return {
    width: x + (lastChannel.runs.length ? channelWidth(lastChannel) : 0) + MARGIN,
    height: height + MARGIN,
    parts: items.map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      value: item.value,
      props: item.part.props,
      symbol: item.symbol,
      flipped: item.flipped,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      pins: item.pins.map((pin) => ({ id: pin.id, label: pin.label, side: pin.side, x: pin.x, y: pin.y, net: pin.net.id })),
    })),
    wires: [...wires.values()],
    flags,
    nets: nets.filter((net) => net.kind === 'signal' && net.ends.length > 1).length,
  };
}

export function layoutDiagram(doc) {
  const graph = connect(doc);
  assignColumns(graph);
  for (const item of graph.items) {
    if (item.symbol) shapeSymbol(item);
    else shapeBlock(item);
  }
  const columns = buildColumns(graph);
  orderColumns(columns);
  columns.slice(1).reduce((rows, column) => {
    placeColumn(column, rows);
    return rowsOf(column);
  }, new Map());
  placeBoard(graph.board, columns[1] ?? []);
  return route(columns, graph);
}
