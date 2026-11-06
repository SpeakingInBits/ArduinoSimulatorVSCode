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

const TICKING_CODE = `import time
while True:
    print("TICK")
    time.sleep(0.03)
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    // A step that fails inside the page never answers, so give up rather than hang.
    const step = (action) => Promise.race([
      session.testStep(action),
      sleep(15000).then(() => { throw new Error(`No answer from the page for ${JSON.stringify(action)}`); }),
    ]);

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

    // The panel's Run button saves and runs what is typed, even though the panel has the focus.
    const program = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), vscode.ViewColumn.One);
    await vscode.commands.executeCommand('metroSim.open');
    await program.edit((edit) => edit.insert(new vscode.Position(0, 0), 'print("UNSAVED EDIT")\n'));
    await vscode.commands.executeCommand('workbench.action.focusNextGroup');
    await sleep(500);
    report.steps.activeEditorWithPanelFocused = vscode.window.activeTextEditor?.document.fileName ?? null;
    if (report.steps.activeEditorWithPanelFocused !== null) throw new Error('The panel did not take the focus');
    await step({ action: 'click', selector: '#run' });
    await step({ action: 'waitConsole', text: 'UNSAVED EDIT' });
    if (program.document.isDirty) throw new Error('Run did not save the program');

    // Restart returns the controls to their defaults, on the page as well as on the board.
    await step({ action: 'slider', key: `${pot}:position`, value: 0.25 });
    await step({ action: 'click', selector: '#run' });
    await sleep(300);
    await step({ action: 'waitConsole', text: 'READY' });
    const restarted = await step({ action: 'read' });
    report.steps.sliderAfterRestart = restarted.sliders[`${pot}:position`];
    if (Number(report.steps.sliderAfterRestart) !== 0.5 || Object.keys(restarted.controlValues).length > 0) {
      throw new Error('Restart left old control values on the page');
    }

    // A double click on Run leaves one board, and Stop stops it.
    const reopened = await vscode.window.showTextDocument(program.document, vscode.ViewColumn.One);
    await reopened.edit((edit) => edit.replace(new vscode.Range(0, 0, reopened.document.lineCount, 0), TICKING_CODE));
    await Promise.all([step({ action: 'click', selector: '#run' }), step({ action: 'click', selector: '#run' })]);
    await sleep(600);
    await step({ action: 'waitConsole', text: 'TICK' });
    await step({ action: 'click', selector: '#stop' });
    await step({ action: 'waitRunning', running: false });
    await sleep(300);
    const afterStop = (await step({ action: 'read' })).console;
    await sleep(500);
    report.steps.outputStoppedAfterStop = afterStop === (await step({ action: 'read' })).console;
    if (!report.steps.outputStoppedAfterStop) throw new Error('A board kept running after Stop');

    // A file in lib/ belongs to the project around it.
    fs.mkdirSync(path.join(folder, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'lib', 'helper.py'), 'VALUE = 1\n');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(folder, 'lib', 'helper.py')), vscode.ViewColumn.One);
    await vscode.commands.executeCommand('metroSim.open');
    report.steps.folderFromLib = path.basename(session.folder);
    if (path.relative(session.folder, folder) !== '') throw new Error(`lib/ became the project: ${session.folder}`);

    // A broken circuit.json is reported and left alone until it is fixed.
    const circuitFile = path.join(folder, 'circuit.json');
    const goodCircuit = fs.readFileSync(circuitFile, 'utf8');
    const circuitEditor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(circuitFile), vscode.ViewColumn.One);
    await circuitEditor.edit((edit) => edit.insert(new vscode.Position(0, 0), 'not json '));
    await circuitEditor.document.save();
    await sleep(500);
    const broken = await step({ action: 'read' });
    report.steps.brokenCircuitError = broken.loadError;
    if (!broken.loadError) throw new Error('A broken circuit.json was not reported');
    await step({ action: 'palette', type: 'resistor' });
    await sleep(600);
    if (!fs.readFileSync(circuitFile, 'utf8').startsWith('not json ')) throw new Error('A broken circuit.json was overwritten');
    await circuitEditor.edit((edit) => edit.delete(new vscode.Range(0, 0, 0, 9)));
    await circuitEditor.document.save();
    await sleep(500);
    const repaired = await step({ action: 'read' });
    if (repaired.loadError || (await step({ action: 'doc' })).wires.length !== 8) throw new Error('The fixed circuit.json did not load');
    if (fs.readFileSync(circuitFile, 'utf8') !== goodCircuit) throw new Error('circuit.json changed');

    // Autocomplete setup keeps existing settings, and never rewrites a file with comments.
    const settingsFile = path.join(folder, '.vscode', 'settings.json');
    const commented = '{\n  // Keep this comment\n  "editor.tabSize": 2,\n}\n';
    fs.writeFileSync(settingsFile, commented);
    await vscode.commands.executeCommand('metroSim.setupEditor');
    if (fs.readFileSync(settingsFile, 'utf8') !== commented) throw new Error('Setup rewrote a settings file with comments');
    fs.writeFileSync(settingsFile, '{ "editor.tabSize": 2, "python.analysis.extraPaths": ["other"] }');
    await vscode.commands.executeCommand('metroSim.setupEditor');
    const merged = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    report.steps.mergedSettings = merged;
    if (merged['editor.tabSize'] !== 2 || merged['python.analysis.extraPaths'].join() !== 'other,lib') throw new Error('Setup lost existing settings');
    report.passed = true;
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
