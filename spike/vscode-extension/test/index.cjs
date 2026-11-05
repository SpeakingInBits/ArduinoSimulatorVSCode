// Entry point for `Code --extensionTestsPath`: runs the self test and records the result.
// With SIM_TEST_HOLD_MS set, it then shows a demo program for a while, for a screenshot.
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const DEMO = `import board, digitalio, neopixel_write, time
led = digitalio.DigitalInOut(board.D13)
led.direction = digitalio.Direction.OUTPUT
led.value = True
pixel = digitalio.DigitalInOut(board.NEOPIXEL)
pixel.direction = digitalio.Direction.OUTPUT
print("Hello from a simulated Metro M0 Express!")
print("board:", board.board_id)
while True:
    neopixel_write.neopixel_write(pixel, bytearray([40, 0, 90]))
    time.sleep(0.1)
`;

const waitFor = async (condition, what) => {
  const deadline = Date.now() + 8000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

// Follows what a student does: open a project file, run it, then press Run again in the panel.
async function runExampleProject() {
  const { exports: simulator } = vscode.extensions.getExtension('speakinginbits.metro-simulator-spike');
  const file = path.join(__dirname, '..', '..', 'example', 'code.py');
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('metroSim.run');
  await waitFor(() => simulator.output().includes('Example running'), 'first run');
  const usedLibFolder = !simulator.output().includes('ImportError');
  await vscode.commands.executeCommand('workbench.action.focusNextGroup');
  const editorActiveDuringRerun = vscode.window.activeTextEditor !== undefined;
  await vscode.commands.executeCommand('metroSim.run');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await waitFor(() => simulator.output().includes('Example running'), 'run from the panel');
  return { usedLibFolder, editorActiveDuringRerun, rerunFromPanel: true };
}

async function run() {
  const output = process.env.SIM_TEST_OUTPUT;
  const holdMs = Number(process.env.SIM_TEST_HOLD_MS ?? 0);
  const extensionHost = {
    vscodeVersion: vscode.version,
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
  };
  try {
    const result = await vscode.commands.executeCommand('metroSim.selfTest');
    const exampleProject = await runExampleProject();
    fs.writeFileSync(output, JSON.stringify({ extensionHost, exampleProject, ...result }, null, 2));
    if (holdMs > 0) {
      await vscode.commands.executeCommand('metroSim.runCode', DEMO);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    }
  } catch (error) {
    fs.writeFileSync(output, JSON.stringify({ extensionHost, passed: false, error: String(error?.stack ?? error) }, null, 2));
  }
}

module.exports = { run };
