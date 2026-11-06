// The page shown when circuit.json is opened: the circuit diagram of the file, as it stands.
import { circuitProblem } from '../shared/catalog.js';
import { createDiagram } from './diagram.js';

const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const diagram = createDiagram($('stage-diagram'), {
  emptyHint: 'Choose Edit circuit to add parts.',
  problemHint: 'Choose Show JSON to fix it, and the diagram will update as you type.',
});

function load(text) {
  let circuit;
  let problem;
  try {
    circuit = JSON.parse(text);
    problem = circuitProblem(circuit);
  } catch (error) {
    problem = error.message;
  }
  diagram.sync(circuit, problem);
  vscode.postMessage({ type: 'shown', ...diagram.info() });
}

$('edit').addEventListener('click', () => vscode.postMessage({ type: 'edit' }));
$('text').addEventListener('click', () => vscode.postMessage({ type: 'text' }));
$('fit').addEventListener('click', () => diagram.fit());

window.addEventListener('message', ({ data }) => {
  if (data.type === 'load') load(data.text);
});
vscode.postMessage({ type: 'ready' });
