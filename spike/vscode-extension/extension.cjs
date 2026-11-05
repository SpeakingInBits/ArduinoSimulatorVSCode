// Spike extension: runs the current file on the simulated board and shows it in a webview.
// The engine runs in a worker thread of the extension host, where SharedArrayBuffer and
// Atomics.wait are always available. The webview only draws and forwards input.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { Board } = require('../host/board.cjs');
const { PINS } = require('../host/parts.cjs');

const PIN_NAMES = Object.fromEntries(Object.entries(PINS).map(([name, pin]) => [pin, name]));
const FLUSH_MS = 33;

const SELF_TEST_CODE = `import analogio, board, digitalio, time
led = digitalio.DigitalInOut(board.D13)
led.direction = digitalio.Direction.OUTPUT
button = digitalio.DigitalInOut(board.D2)
button.switch_to_input(pull=digitalio.Pull.UP)
pot = analogio.AnalogIn(board.A0)
print("READY")
last = None
while True:
    led.value = not button.value
    value = pot.value >> 4
    if value != last:
        print("POT", value)
        last = value
    time.sleep(0.02)
`;

function readLibFolder(folder) {
  const files = {};
  const walk = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}/${entry.name}`);
      else files[`${prefix}/${entry.name}`] = fs.readFileSync(full);
    }
  };
  if (fs.existsSync(folder)) walk(folder, '/lib');
  return files;
}

function activate(context) {
  let panel;
  let board;
  let ready;
  let flushTimer;
  const pendingPins = new Map();
  let selfTestDone;
  let lastDocument;

  const post = (message) => panel?.webview.postMessage(message);

  // A tight Python loop can toggle a pin far faster than a screen can show it.
  const flushPins = () => {
    flushTimer = undefined;
    if (pendingPins.size > 0) post({ type: 'pins', pins: Object.fromEntries(pendingPins) });
    pendingPins.clear();
  };

  async function startBoard(files) {
    await board?.stop();
    post({ type: 'reset' });
    board = new Board({ files });
    board.on('serial', (text) => post({ type: 'serial', text }));
    board.on('pin', ({ pin, value }) => {
      pendingPins.set(PIN_NAMES[pin] ?? pin, value);
      flushTimer ??= setTimeout(flushPins, FLUSH_MS);
    });
    board.on('neopixel', ({ data }) => post({ type: 'neopixel', green: data[0], red: data[1], blue: data[2] }));
    board.on('crash', (message) => post({ type: 'serial', text: `\n[simulator crashed] ${message}\n` }));
  }

  function openPanel() {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Beside, true);
      return ready;
    }
    panel = vscode.window.createWebviewPanel('metroSim', 'Metro M0 Express', {
      viewColumn: vscode.ViewColumn.Beside, preserveFocus: true,
    }, { enableScripts: true, retainContextWhenHidden: true });
    const nonce = crypto.randomBytes(16).toString('hex');
    panel.webview.html = fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8')
      .replaceAll('{{nonce}}', nonce)
      .replaceAll('{{cspSource}}', panel.webview.cspSource);
    ready = new Promise((resolve) => {
      panel.webview.onDidReceiveMessage((message) => {
        if (message.type === 'ready') resolve();
        else if (message.type === 'input') board?.write(message.text);
        else if (message.type === 'pin') board?.setPin(PINS[message.pin], message.level);
        else if (message.type === 'adc') board?.setAdc(PINS[message.pin], message.value);
        else if (message.type === 'stop') board?.write('\x03');
        else if (message.type === 'run') vscode.commands.executeCommand('metroSim.run');
        else if (message.type === 'selfTestResult') selfTestDone?.(message.result);
      });
    });
    panel.onDidDispose(() => {
      board?.stop();
      board = undefined;
      panel = undefined;
    });
    return ready;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('metroSim.run', async () => {
      // Clicking Run in the panel moves focus away from the editor, so remember the file.
      const document = vscode.window.activeTextEditor?.document ?? lastDocument;
      lastDocument = document;
      if (!document) {
        vscode.window.showWarningMessage('Open a CircuitPython file first.');
        return;
      }
      await document.save();
      await openPanel();
      const projectLib = path.join(path.dirname(document.uri.fsPath), 'lib');
      await startBoard({ '/code.py': document.getText(), ...readLibFolder(projectLib) });
    }),

    vscode.commands.registerCommand('metroSim.runCode', async (code) => {
      await openPanel();
      await startBoard({ '/code.py': code });
    }),

    vscode.commands.registerCommand('metroSim.selfTest', async () => {
      await openPanel();
      await startBoard({ '/code.py': SELF_TEST_CODE });
      const result = new Promise((resolve) => { selfTestDone = resolve; });
      post({ type: 'selfTest' });
      return result;
    }),

    { dispose: () => board?.stop() },
  );

  return { output: () => board?.output ?? '' };
}

module.exports = { activate };
