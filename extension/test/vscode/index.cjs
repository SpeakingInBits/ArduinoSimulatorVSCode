// End-to-end test run inside a real VS Code window with `Code --extensionTestsPath`. It builds
// a circuit through the page's own controls, runs a program and checks the page reacts.
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const CODE = `import analogio, board, digitalio, pwmio, time
led = digitalio.DigitalInOut(board.D5)
led.direction = digitalio.Direction.OUTPUT
button = digitalio.DigitalInOut(board.D2)
button.switch_to_input(pull=digitalio.Pull.UP)
pot = analogio.AnalogIn(board.A0)
print("READY")
last = None
while True:
    led.value = not button.value
    value = pot.value >> 4
    if last is None or abs(value - last) > 20:
        print("POT", value)
        last = value
    time.sleep(0.02)
`;

const pinOf = (doc, id, pin, catalog) => {
  const part = doc.parts.find((p) => p.id === id);
  const definition = catalog.definition(part.type).pins.find((p) => p.id === pin);
  return catalog.pinPosition(part, definition);
};

async function run() {
  const folder = process.env.SIM_TEST_FOLDER;
  const output = process.env.SIM_TEST_OUTPUT;
  const holdMs = Number(process.env.SIM_TEST_HOLD_MS ?? 0);
  const report = { vscode: vscode.version, node: process.versions.node, steps: {} };
  try {
    const file = path.join(folder, 'code.py');
    fs.writeFileSync(file, CODE);
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('metroSim.open');
    const extension = vscode.extensions.getExtension('speakinginbits.metro-simulator');
    const { session } = extension.exports;
    const catalog = await import(path.join(extension.extensionPath, 'shared', 'catalog.js').replace(/\\/g, '/').replace(/^([A-Z]):/, 'file:///$1:'));
    const step = (action) => session.testStep(action);

    // Place parts from the palette and drag them into position.
    const resistor = (await step({ action: 'palette', type: 'resistor' })).id;
    await step({ action: 'move', id: resistor, grab: { x: 20, y: 0 }, x: 400, y: 80 });
    const led = (await step({ action: 'palette', type: 'led' })).id;
    await step({ action: 'move', id: led, grab: { x: 5, y: -1 }, x: 480, y: 70 });
    const button = (await step({ action: 'palette', type: 'button' })).id;
    await step({ action: 'move', id: button, grab: { x: 10, y: 15 }, x: 400, y: 130 });
    const pot = (await step({ action: 'palette', type: 'potentiometer' })).id;
    await step({ action: 'move', id: pot, grab: { x: 10, y: 6 }, x: 480, y: 130 });
    await step({ action: 'fit' });

    // Draw wires by clicking pins.
    const wire = async (fromId, fromPin, toId, toPin) => {
      const doc = await step({ action: 'doc' });
      await step({ action: 'clickPoint', point: pinOf(doc, fromId, fromPin, catalog) });
      return step({ action: 'clickPoint', point: pinOf(doc, toId, toPin, catalog) });
    };
    await wire('board', 'D5', resistor, '1');
    await wire(resistor, '2', led, 'A');
    await wire(led, 'K', 'board', 'GND1');
    await wire('board', 'D2', button, '1a');
    await wire(button, '2a', 'board', 'GND2');
    await wire('board', '3V', pot, '2');
    await wire(pot, '1', 'board', 'GND3');
    const last = await wire(pot, 'W', 'board', 'A0');
    report.steps.wiresDrawn = last.wires;
    if (last.wires !== 8) throw new Error(`Expected 8 wires, got ${last.wires}`);

    // Undo, then redo, a wire.
    const undone = await step({ action: 'key', key: 'z', ctrl: true });
    const redone = await step({ action: 'key', key: 'y', ctrl: true });
    report.steps.undoRedo = `${undone.wires} then ${redone.wires}`;
    if (undone.wires !== 7 || redone.wires !== 8) throw new Error('Undo or redo failed');

    // Saved next to the code.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const saved = JSON.parse(fs.readFileSync(path.join(folder, 'circuit.json'), 'utf8'));
    report.steps.savedWires = saved.wires.length;
    if (saved.wires.length !== 8) throw new Error('circuit.json was not saved');

    // Run it, then use the part on the canvas and the slider.
    await step({ action: 'click', selector: '#run' });
    await step({ action: 'waitRunning', running: true });
    report.steps.startToReadyMs = (await step({ action: 'waitConsole', text: 'READY' })).ms;
    const doc = await step({ action: 'doc' });
    const part = doc.parts.find((p) => p.id === button);
    await step({ action: 'pressPart', point: { x: part.x + 10, y: part.y + 15 } });
    report.steps.pressToLedMs = (await step({ action: 'waitView', id: led, equals: [['burned', false]] })).ms;
    const lit = await waitBright(step, led, true);
    report.steps.ledBrightness = lit;
    await step({ action: 'release' });
    await waitBright(step, led, false);
    await step({ action: 'slider', key: `${pot}:position`, value: 0.25 });
    report.steps.sliderToConsoleMs = (await step({ action: 'waitConsole', text: 'POT 10' })).ms;

    // Stop, and the page returns to editing.
    await step({ action: 'click', selector: '#stop' });
    await step({ action: 'waitRunning', running: false });
    report.steps.stopped = true;
    const final = await step({ action: 'read' });
    report.sharedArrayBufferInWebview = final.sharedArrayBuffer;
    report.problems = final.problems;
    report.passed = true;

    // Autocomplete setup writes stubs and settings into the project.
    await vscode.commands.executeCommand('metroSim.setupEditor');
    report.steps.stubsInstalled = fs.existsSync(path.join(folder, 'typings', 'digitalio-stubs'));
    if (!report.steps.stubsInstalled) throw new Error('Autocomplete stubs were not copied');

    // A shipped example, which has a breadboard, opens and runs.
    const example = path.join(path.dirname(folder), 'e2e-example');
    fs.cpSync(path.join(extension.extensionPath, 'examples', 'led-and-button'), example, { recursive: true });
    const exampleDocument = await vscode.workspace.openTextDocument(path.join(example, 'code.py'));
    await vscode.window.showTextDocument(exampleDocument, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('metroSim.run');
    await step({ action: 'waitRunning', running: true });
    await step({ action: 'waitConsole', text: 'code.py output:' });
    const exampleDoc = await step({ action: 'doc' });
    const exampleButton = exampleDoc.parts.find((p) => p.id === 'button1');
    await step({ action: 'fit' });
    await step({ action: 'pressPart', point: { x: exampleButton.x + 10, y: exampleButton.y + 15 } });
    report.steps.exampleLedBrightness = await waitBright(step, 'led1', true);
    report.problems = (await step({ action: 'read' })).problems;
  } catch (error) {
    report.passed = false;
    report.error = String(error?.stack ?? error);
  }
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
}

async function waitBright(step, id, on) {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    const { views } = await step({ action: 'read' });
    const level = views[id]?.brightness ?? 0;
    if (on ? level > 0.3 : level === 0) return level;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`LED did not turn ${on ? 'on' : 'off'}`);
}

module.exports = { run };
