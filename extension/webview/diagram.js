// The page shown when circuit.json is opened: a read-only circuit diagram of the file.
import { circuitProblem } from '../shared/catalog.js';
import { renderDiagram } from './diagram-art.js';
import { layoutDiagram } from './diagram-layout.js';

const vscode = acquireVsCodeApi();
const MAX_FIT_ZOOM = 2;
const FIT_PADDING = 16;

const $ = (id) => document.getElementById(id);
const svg = $('diagram');
const sheet = $('sheet');
// `autoFit` holds until the student moves the view, so their place is kept as the circuit changes.
const view = { zoom: 1, pan: { x: 0, y: 0 }, panning: null, model: null, autoFit: true };

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function applyView() {
  sheet.setAttribute('transform', `translate(${view.pan.x} ${view.pan.y}) scale(${view.zoom})`);
}

function fit() {
  const { model } = view;
  const box = svg.getBoundingClientRect();
  if (!model || box.width === 0) return;
  view.zoom = Math.min(MAX_FIT_ZOOM, (box.width - FIT_PADDING) / model.width, (box.height - FIT_PADDING) / model.height);
  view.pan = { x: (box.width - model.width * view.zoom) / 2, y: (box.height - model.height * view.zoom) / 2 };
  applyView();
}

function showMessage(html) {
  $('message').hidden = !html;
  $('message').innerHTML = html;
}

function showProblem(problem) {
  view.model = null;
  sheet.innerHTML = '';
  $('summary').textContent = '';
  const text = document.createElement('p');
  text.textContent = problem;
  showMessage(`<h2>circuit.json needs fixing</h2>${text.outerHTML}<p>Choose Show JSON to fix it, and the diagram will update as you type.</p>`);
  vscode.postMessage({ type: 'shown', problem });
}

function show(circuit) {
  const model = layoutDiagram(circuit);
  const parts = model.parts.length - 1;
  view.model = model;
  sheet.innerHTML = renderDiagram(model);
  $('summary').textContent = `${plural(parts, 'part')}, ${plural(model.nets, 'connection')}`;
  showMessage(parts === 0 ? '<p>Nothing is connected to the board yet. Choose Edit circuit to add parts.</p>' : '');
  if (view.autoFit) fit();
  vscode.postMessage({ type: 'shown', parts, wires: model.wires.length, flags: model.flags.length });
}

function load(text) {
  let circuit;
  try {
    circuit = JSON.parse(text);
  } catch (error) {
    showProblem(error.message);
    return;
  }
  const problem = circuitProblem(circuit);
  if (problem) showProblem(problem);
  else show(circuit);
}

// Hovering a wire lights up everything joined to it, which also tells a crossing from a junction.
function highlight(net) {
  for (const element of sheet.querySelectorAll('.d-net')) element.classList.toggle('active', element.dataset.net === net);
}

svg.addEventListener('pointerover', (event) => highlight(event.target.closest?.('.d-net')?.dataset.net));
svg.addEventListener('pointerleave', () => highlight(undefined));

svg.addEventListener('pointerdown', (event) => {
  svg.setPointerCapture?.(event.pointerId);
  view.panning = { x: event.clientX - view.pan.x, y: event.clientY - view.pan.y };
});

svg.addEventListener('pointermove', (event) => {
  if (!view.panning) return;
  view.autoFit = false;
  view.pan = { x: event.clientX - view.panning.x, y: event.clientY - view.panning.y };
  applyView();
});

const endPan = () => { view.panning = null; };
svg.addEventListener('pointerup', endPan);
svg.addEventListener('pointercancel', endPan);

svg.addEventListener('wheel', (event) => {
  event.preventDefault();
  const box = svg.getBoundingClientRect();
  const x = event.clientX - box.left;
  const y = event.clientY - box.top;
  const zoom = Math.max(0.2, Math.min(5, view.zoom * Math.exp(-event.deltaY * 0.0015)));
  view.pan.x = x - ((x - view.pan.x) / view.zoom) * zoom;
  view.pan.y = y - ((y - view.pan.y) / view.zoom) * zoom;
  view.zoom = zoom;
  view.autoFit = false;
  applyView();
}, { passive: false });

$('edit').addEventListener('click', () => vscode.postMessage({ type: 'edit' }));
$('text').addEventListener('click', () => vscode.postMessage({ type: 'text' }));
$('fit').addEventListener('click', () => {
  view.autoFit = true;
  fit();
});
new ResizeObserver(() => { if (view.autoFit) fit(); }).observe(svg);

window.addEventListener('message', ({ data }) => {
  if (data.type === 'load') load(data.text);
});
vscode.postMessage({ type: 'ready' });
