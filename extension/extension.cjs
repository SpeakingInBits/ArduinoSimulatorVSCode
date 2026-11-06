// VS Code entry point. Everything simulated lives in sim/, and the UI lives in webview/.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const CIRCUIT_FILE = 'circuit.json';
const IGNORED = new Set(['.git', '.vscode', 'typings', 'node_modules', '__pycache__', CIRCUIT_FILE]);
const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
const SAVE_DELAY_MS = 300;

// Libraries each library needs in order to import.
const LIBRARY_NEEDS = {
  adafruit_character_lcd: ['adafruit_bus_device', 'adafruit_mcp230xx'],
  adafruit_displayio_ssd1306: ['adafruit_display_text'],
  adafruit_ds18x20: ['adafruit_onewire'],
  adafruit_ds3231: ['adafruit_bus_device', 'adafruit_register'],
  adafruit_max7219: ['adafruit_bus_device', 'adafruit_framebuf'],
  adafruit_mcp9808: ['adafruit_bus_device', 'adafruit_register'],
  adafruit_mpu6050: ['adafruit_bus_device', 'adafruit_register'],
  adafruit_ssd1306: ['adafruit_bus_device', 'adafruit_framebuf'],
  adafruit_74hc595: ['adafruit_bus_device'],
  neopixel: ['adafruit_pixelbuf'],
};

let session;

function readProjectFiles(folder, activeDocument) {
  const files = {};
  let total = 0;
  const walk = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${prefix}/${entry.name}`);
      } else {
        const data = fs.readFileSync(full);
        total += data.length;
        if (total > MAX_PROJECT_BYTES) throw new Error('This project is larger than the 2MB CIRCUITPY drive.');
        files[`${prefix}/${entry.name}`] = data;
      }
    }
  };
  walk(folder, '');
  // Whatever Python file is open runs as the program, as if saved to the board as code.py.
  if (activeDocument?.languageId === 'python') files['/code.py'] = activeDocument.getText();
  return files;
}

function projectFolder() {
  const document = vscode.window.activeTextEditor?.document;
  if (document?.uri.scheme === 'file') return path.dirname(document.uri.fsPath);
  return session?.folder ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

class Session {
  constructor(context) {
    this.context = context;
    this.folder = undefined;
    this.panel = undefined;
    this.ready = undefined;
    this.board = undefined;
    this.document = undefined;
    this.nvm = undefined;
    this.pendingTests = new Map();
    this.nextTest = 1;
  }

  post(message) {
    this.panel?.webview.postMessage(message);
  }

  circuitPath() {
    return path.join(this.folder, CIRCUIT_FILE);
  }

  readCircuit() {
    try {
      return JSON.parse(fs.readFileSync(this.circuitPath(), 'utf8'));
    } catch {
      return undefined;
    }
  }

  saveCircuit(circuit) {
    this.circuit = circuit;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.folder) fs.writeFileSync(this.circuitPath(), `${JSON.stringify(circuit, null, 2)}\n`);
    }, SAVE_DELAY_MS);
  }

  html(webview) {
    const root = this.context.extensionUri;
    const webviewRoot = webview.asWebviewUri(vscode.Uri.joinPath(root, 'webview'));
    return fs.readFileSync(path.join(this.context.extensionPath, 'webview', 'index.html'), 'utf8')
      .replaceAll('{{nonce}}', crypto.randomBytes(16).toString('hex'))
      .replaceAll('{{cspSource}}', webview.cspSource)
      .replaceAll('{{webviewRoot}}', webviewRoot.toString());
  }

  async open(folder) {
    if (!folder) {
      vscode.window.showWarningMessage('Open a project folder first, or create one with "New Project from Example".');
      return false;
    }
    if (this.panel && this.folder !== folder) await this.stop();
    this.folder = folder;
    if (this.panel) {
      this.panel.reveal(undefined, true);
      await this.ready;
    } else {
      this.panel = vscode.window.createWebviewPanel('metroSim', 'Circuit Simulator', {
        viewColumn: vscode.ViewColumn.Beside, preserveFocus: true,
      }, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      });
      this.ready = new Promise((resolve) => { this.markReady = resolve; });
      this.panel.webview.onDidReceiveMessage((message) => this.onMessage(message));
      this.panel.onDidDispose(() => {
        this.stop();
        this.panel = undefined;
      });
      this.panel.webview.html = this.html(this.panel.webview);
      await this.ready;
    }
    this.circuit = this.readCircuit();
    this.post({ type: 'load', circuit: this.circuit });
    return true;
  }

  onMessage(message) {
    switch (message.type) {
      case 'ready': this.markReady(); break;
      case 'save': this.saveCircuit(message.circuit); break;
      case 'run': this.run(); break;
      case 'stop': this.stop(); break;
      case 'input': this.board?.write(message.text); break;
      case 'control': this.board?.setControl(message.part, message.control, message.value); break;
      case 'testResult':
        this.pendingTests.get(message.id)?.(message.result);
        this.pendingTests.delete(message.id);
        break;
      default: break;
    }
  }

  async stop() {
    const { board } = this;
    this.board = undefined;
    await board?.stop();
    this.post({ type: 'running', running: false });
  }

  async run() {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId === 'python') this.document = editor.document;
    const document = this.document;
    if (document?.isDirty) await document.save();
    if (!this.folder) {
      vscode.window.showWarningMessage('Open a project folder first.');
      return;
    }
    let files;
    try {
      files = readProjectFiles(this.folder, document);
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
      return;
    }
    if (!files['/code.py']) {
      vscode.window.showWarningMessage('This project has no code.py. Open a Python file to run it.');
      return;
    }
    const { Board } = await import('./sim/board-host.js');
    const { emptyCircuit } = await import('./shared/catalog.js');
    const previous = this.board;
    this.board = undefined;
    await previous?.stop();
    this.post({ type: 'clearConsole' });
    const board = new Board({
      files,
      circuit: this.circuit ?? emptyCircuit(),
      nvm: this.nvm,
    });
    this.board = board;
    const forward = (type) => board.on(type, (message) => this.post(message));
    board.on('serial', (text) => this.post({ type: 'serial', text }));
    ['frame', 'audioStart', 'audio', 'audioStop'].forEach(forward);
    board.on('nvm', ({ data }) => { this.nvm = data; });
    board.on('reset', () => this.run());
    board.on('crash', (text) => this.post({ type: 'serial', text: `\n[Simulator error] ${text}\n` }));
    this.post({ type: 'running', running: true });
  }

  // Used by the automated tests to drive the page.
  testStep(step) {
    const id = this.nextTest++;
    return new Promise((resolve) => {
      this.pendingTests.set(id, resolve);
      this.post({ type: 'test', id, step });
    });
  }
}

function copyFolder(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function libraryPath(context, name) {
  const base = path.join(context.extensionPath, 'libs', name);
  return fs.existsSync(`${base}.mpy`) ? `${base}.mpy` : base;
}

function installLibrary(context, folder, name, seen = new Set()) {
  if (seen.has(name)) return;
  seen.add(name);
  const source = libraryPath(context, name);
  if (fs.existsSync(source)) {
    const target = path.join(folder, 'lib', path.basename(source));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
  }
  for (const needed of LIBRARY_NEEDS[name] ?? []) installLibrary(context, folder, needed, seen);
}

async function newProject(context) {
  const examples = path.join(context.extensionPath, 'examples');
  const picks = fs.readdirSync(examples).map((name) => {
    const info = JSON.parse(fs.readFileSync(path.join(examples, name, 'example.json'), 'utf8'));
    return { label: info.title, detail: info.description, name, libraries: info.libraries ?? [] };
  });
  const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Choose a starting project' });
  if (!pick) return;
  const parent = await vscode.window.showOpenDialog({
    canSelectFolders: true, canSelectFiles: false, openLabel: 'Create project here',
  });
  if (!parent) return;
  const target = path.join(parent[0].fsPath, pick.name);
  if (fs.existsSync(target)) {
    vscode.window.showErrorMessage(`${target} already exists.`);
    return;
  }
  copyFolder(path.join(examples, pick.name), target);
  fs.rmSync(path.join(target, 'example.json'));
  for (const library of pick.libraries) installLibrary(context, target, library);
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target));
}

async function addLibrary(context) {
  const folder = projectFolder();
  if (!folder) return;
  const libs = path.join(context.extensionPath, 'libs');
  const names = fs.readdirSync(libs).map((name) => name.replace(/\.mpy$/, '')).sort();
  const pick = await vscode.window.showQuickPick(names, { placeHolder: 'Library to copy into this project\'s lib folder' });
  if (!pick) return;
  installLibrary(context, folder, pick);
  vscode.window.showInformationMessage(`Added ${pick} to ${path.join(folder, 'lib')}.`);
}

// Copies CircuitPython's type stubs into the project so Pylance can offer autocomplete.
function setupEditor(context) {
  const folder = projectFolder();
  if (!folder) return;
  const stubs = path.join(context.extensionPath, 'stubs');
  if (fs.existsSync(stubs)) fs.cpSync(stubs, path.join(folder, 'typings'), { recursive: true });
  const settingsPath = path.join(folder, '.vscode', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    // No usable settings file yet.
  }
  settings['python.analysis.extraPaths'] = ['lib'];
  settings['python.analysis.diagnosticSeverityOverrides'] = {
    ...settings['python.analysis.diagnosticSeverityOverrides'], reportMissingModuleSource: 'none',
  };
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  vscode.window.showInformationMessage('CircuitPython autocomplete is set up. Install the Python extension if you have not already.');
}

function findBoardDrive() {
  const candidates = [];
  if (process.platform === 'win32') {
    for (let letter = 68; letter <= 90; letter++) candidates.push(`${String.fromCharCode(letter)}:\\`);
  } else if (process.platform === 'darwin') {
    candidates.push('/Volumes/CIRCUITPY');
  } else {
    candidates.push(`/media/${os.userInfo().username}/CIRCUITPY`, `/run/media/${os.userInfo().username}/CIRCUITPY`);
  }
  return candidates.find((drive) => fs.existsSync(path.join(drive, 'boot_out.txt')));
}

async function copyToBoard() {
  const folder = projectFolder();
  if (!folder) return;
  const drive = findBoardDrive();
  if (!drive) {
    vscode.window.showWarningMessage('No CIRCUITPY drive found. Plug in your board with a data USB cable.');
    return;
  }
  const answer = await vscode.window.showWarningMessage(`Copy this project to ${drive}? Files with the same names will be replaced.`, { modal: true }, 'Copy');
  if (answer !== 'Copy') return;
  const files = readProjectFiles(folder);
  for (const [file, data] of Object.entries(files)) {
    const target = path.join(drive, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  vscode.window.showInformationMessage(`Copied ${Object.keys(files).length} files to ${drive}.`);
}

function activate(context) {
  session = new Session(context);
  const command = (id, handler) => context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  command('metroSim.open', () => session.open(projectFolder()));
  command('metroSim.run', async () => {
    if (await session.open(projectFolder())) await session.run();
  });
  command('metroSim.stop', () => session.stop());
  command('metroSim.newProject', () => newProject(context));
  command('metroSim.addLibrary', () => addLibrary(context));
  command('metroSim.setupEditor', () => setupEditor(context));
  command('metroSim.copyToBoard', copyToBoard);
  context.subscriptions.push({ dispose: () => session.stop() });
  return { session };
}

module.exports = { activate };
