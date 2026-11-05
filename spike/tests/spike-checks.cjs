// Runs the spike's pass/fail checks. Usage: node spike-checks.cjs [check name filter]
const fs = require('node:fs');
const path = require('node:path');
const { Board } = require('../host/board.cjs');
const { PINS } = require('../host/parts.cjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PARTS = path.join(__dirname, 'test-parts.cjs');

function libFiles(kind, names) {
  const root = path.join(__dirname, 'libs', kind);
  const files = {};
  const add = (full, relative) => {
    if (fs.statSync(full).isDirectory()) {
      for (const entry of fs.readdirSync(full)) add(path.join(full, entry), `${relative}/${entry}`);
    } else {
      files[`/lib/${relative}`] = fs.readFileSync(full);
    }
  };
  for (const name of names) add(path.join(root, name), name);
  return files;
}

async function runCode(code, { extraFiles = {}, timeoutMs = 8000, until = 'Code done running', options = {} } = {}) {
  const board = new Board({ files: { '/code.py': code, ...extraFiles }, ...options });
  const crash = new Promise((_, reject) => board.on('crash', (message) => reject(new Error(message))));
  try {
    await Promise.race([board.waitForOutput(until, timeoutMs), crash]);
    return board.output;
  } finally {
    await board.stop();
  }
}

function expectContains(output, text) {
  if (!output.includes(text)) throw new Error(`Expected ${JSON.stringify(text)} in:\n${output}`);
}

const checks = {
  async 'REPL evaluates typed input'() {
    const board = new Board({ files: { '/code.py': 'print("ready")\n' } });
    await board.waitForOutput('Press any key to enter the REPL');
    board.write('\r');
    await board.waitForOutput('>>> ');
    board.write('6 * 7\r');
    await board.waitForOutput('42');
    await board.stop();
  },

  async 'blink loop toggles the pin at the requested rate'() {
    const code = `import board, digitalio, time
led = digitalio.DigitalInOut(board.D13)
led.direction = digitalio.Direction.OUTPUT
while True:
    led.value = True
    time.sleep(0.1)
    led.value = False
    time.sleep(0.1)
`;
    const board = new Board({ files: { '/code.py': code } });
    const edges = [];
    board.on('pin', ({ pin, value, at }) => {
      if (pin === PINS.D13) edges.push({ value, at });
    });
    await board.waitForOutput('code.py output:');
    await sleep(2200);
    await board.stop();
    // The first edge is the pin being configured as an output, just before the loop starts.
    const blinks = edges.slice(1);
    const gaps = blinks.slice(1).map((edge, i) => edge.at - blinks[i].at);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (edges.length < 15 || Math.abs(mean - 100) > 10) {
      throw new Error(`${edges.length} edges, mean gap ${mean.toFixed(1)}ms`);
    }
    return `${edges.length} edges, mean gap ${mean.toFixed(1)}ms, worst ${Math.max(...gaps).toFixed(1)}ms`;
  },

  async 'Stop interrupts time.sleep'() {
    const board = new Board({ files: { '/code.py': 'import time\nprint("start")\ntime.sleep(60)\n' } });
    await board.waitForOutput('start');
    const stoppedAt = performance.now();
    board.write('\x03');
    await board.waitForOutput('KeyboardInterrupt', 3000);
    const elapsed = performance.now() - stoppedAt;
    await board.stop();
    return `stopped in ${elapsed.toFixed(0)}ms`;
  },

  async 'Stop interrupts a busy loop'() {
    const board = new Board({ files: { '/code.py': 'print("start")\nwhile True:\n    pass\n' } });
    await board.waitForOutput('start');
    await sleep(300);
    const stoppedAt = performance.now();
    board.write('\x03');
    await board.waitForOutput('KeyboardInterrupt', 3000);
    const elapsed = performance.now() - stoppedAt;
    await board.stop();
    return `stopped in ${elapsed.toFixed(0)}ms`;
  },

  async 'button input and pull resistors'() {
    const code = `import board, digitalio, time
button = digitalio.DigitalInOut(board.D2)
button.switch_to_input(pull=digitalio.Pull.UP)
print("idle", button.value)
print("wait")
while button.value:
    time.sleep(0.01)
print("pressed", button.value)
`;
    const board = new Board({ files: { '/code.py': code } });
    await board.waitForOutput('wait');
    expectContains(board.output, 'idle True');
    board.setPin(PINS.D2, 0);
    await board.waitForOutput('pressed False', 2000);
    await board.stop();
  },

  async 'analog input follows the simulated voltage'() {
    const code = `import board, analogio, time
pot = analogio.AnalogIn(board.A0)
print("wait")
time.sleep(0.2)
print("value", pot.value, round(pot.value * pot.reference_voltage / 65535, 2))
`;
    const board = new Board({ files: { '/code.py': code } });
    await board.waitForOutput('wait');
    board.setAdc(PINS.A0, 2048);
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'value 32776 1.65');
  },

  async 'garbage collector keeps objects held by C code'() {
    const output = await runCode(fs.readFileSync(path.join(__dirname, 'gc_stress.py')), {
      timeoutMs: 60000, until: 'Code done running',
    });
    expectContains(output, 'GC_STRESS_PASSED 150 rounds');
    return output.match(/GC_STRESS_PASSED.*/)[0];
  },

  async 'running out of memory raises MemoryError'() {
    const output = await runCode(`import gc
try:
    data = bytearray(40000)
except MemoryError as error:
    print("caught", error)
keep = []
try:
    while True:
        keep.append(bytearray(1000))
except MemoryError:
    count = len(keep)
    keep = None
    gc.collect()
    print("filled", count, "free", gc.mem_free())
`);
    expectContains(output, 'caught memory allocation failed, allocating 40000 bytes');
    const filled = Number(output.match(/filled (\d+)/)[1]);
    if (filled < 10 || filled > 25) throw new Error(`Filled ${filled}KB:\n${output}`);
    return output.match(/filled.*/)[0];
  },

  async 'deep recursion fails cleanly'() {
    const output = await runCode('def down(n):\n    return down(n + 1)\ndown(0)\n');
    expectContains(output, 'RuntimeError');
    return output.match(/RuntimeError.*/)[0];
  },

  async 'large .py library exhausts M0 memory, as source compiled on the board'() {
    const code = `import adafruit_character_lcd.character_lcd
print("imported")
`;
    const files = libFiles('py', ['adafruit_character_lcd']);
    const small = await runCode(code, { extraFiles: files });
    expectContains(small, 'MemoryError');
    const large = await runCode(code, { extraFiles: files, options: { portHeapBytes: 128 * 1024 } });
    expectContains(large, 'imported');
    return 'MemoryError at M0 size, imports fine with a 128KB heap';
  },

  async 'unmodified .mpy libraries: character LCD'() {
    return lcdCheck('mpy');
  },

  async 'unmodified library: servo through PWM'() {
    const code = `import board, pwmio, time
from adafruit_motor import servo
pwm = pwmio.PWMOut(board.D9, duty_cycle=0, frequency=50)
motor = servo.Servo(pwm, min_pulse=500, max_pulse=2500)
for angle in (0, 90, 180):
    motor.angle = angle
    time.sleep(0.02)
print("servo done")
`;
    const board = new Board({
      files: { '/code.py': code, ...libFiles('mpy', ['adafruit_motor']) },
      partsModule: PARTS, partsConfig: { servo: PINS.D9 },
    });
    const angles = [];
    board.on('angle', ({ angle }) => angles.push(angle));
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'servo done');
    const seen = [0, 90, 180].every((target) => angles.some((angle) => Math.abs(angle - target) <= 1));
    if (!seen) throw new Error(`Angles ${angles.join(', ')}`);
    return `angles ${angles.join(', ')}`;
  },

  async 'unmodified library: I2C temperature sensor'() {
    const code = `import board, busio
import adafruit_mcp9808
i2c = busio.I2C(board.SCL, board.SDA)
sensor = adafruit_mcp9808.MCP9808(i2c)
print("temperature", sensor.temperature)
`;
    const board = new Board({
      files: { '/code.py': code, ...libFiles('mpy', ['adafruit_mcp9808.mpy', 'adafruit_bus_device', 'adafruit_register']) },
      partsModule: PARTS, partsConfig: { mcp9808: true },
    });
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'temperature 22.5');
  },

  async 'unmodified library: NeoPixel'() {
    const code = `import board, neopixel
pixels = neopixel.NeoPixel(board.NEOPIXEL, 1, auto_write=True)
pixels[0] = (10, 20, 30)
print("pixel done")
`;
    const board = new Board({
      files: { '/code.py': code, ...libFiles('mpy', ['neopixel.mpy', 'adafruit_pixelbuf.mpy']) },
    });
    const writes = [];
    board.on('neopixel', ({ pin, data }) => pin === PINS.NEOPIXEL && writes.push([...data]));
    await board.waitForOutput('pixel done');
    await sleep(100);
    await board.stop();
    if (!writes.some((data) => data[0] === 20 && data[1] === 10 && data[2] === 30)) {
      throw new Error(`Writes ${JSON.stringify(writes)}\n${board.output}`);
    }
    return 'GRB bytes 20, 10, 30 written to the NeoPixel pin';
  },

  async 'student mistakes give the real error messages'() {
    const cases = [
      ['pin in use', 'import board, digitalio\na = digitalio.DigitalInOut(board.D5)\nb = digitalio.DigitalInOut(board.D5)\n', 'ValueError: D5 in use'],
      ['no such pin', 'import board\nprint(board.D99)\n', "AttributeError: 'module' object has no attribute 'D99'"],
      ['analog read on digital pin', 'import board, analogio\na = analogio.AnalogIn(board.D13)\n', 'ValueError: Invalid pin'],
      ['DAC on wrong pin', 'import board, analogio\na = analogio.AnalogOut(board.A1)\n', 'ValueError: Invalid pin'],
      ['PWM on A0', 'import board, pwmio\np = pwmio.PWMOut(board.A0)\n', 'ValueError: Invalid pin'],
      ['write to input', 'import board, digitalio\nd = digitalio.DigitalInOut(board.D2)\nd.value = True\n', 'AttributeError: Cannot set value when direction is input.'],
      ['duty out of range', 'import board, pwmio\np = pwmio.PWMOut(board.D9)\np.duty_cycle = 70000\n', 'ValueError: duty_cycle must be 0-65535'],
      ['I2C on wrong pins', 'import board, busio\ni = busio.I2C(board.D2, board.D3)\n', 'ValueError: Invalid pins'],
      ['missing library', 'import adafruit_nothing\n', "ImportError: no module named 'adafruit_nothing'"],
      ['feature missing on M0', 'import json\n', "ImportError: no module named 'json'"],
    ];
    const failures = [];
    for (const [name, code, expected] of cases) {
      const output = await runCode(code);
      if (!output.includes(expected)) failures.push(`${name}: wanted "${expected}"\n${output.split('code.py output:')[1]?.slice(0, 240)}`);
    }
    const pullups = await runCode('import board\ni = board.I2C()\n', { options: { i2cPullups: false } });
    if (!pullups.includes('RuntimeError: No pull up found on SDA or SCL; check your wiring')) failures.push(`pull-ups:\n${pullups}`);
    if (failures.length) throw new Error(failures.join('\n---\n'));
    return `${cases.length + 1} messages matched`;
  },

  async 'module list compared with the real Metro M0 Express'() {
    const real = ['adafruit_pixelbuf', 'analogio', 'array', 'audiobusio', 'audiocore', 'audioio', 'board',
      'builtins', 'busdisplay', 'busio', 'collections', 'digitalio', 'displayio', 'epaperdisplay', 'fontio',
      'fourwire', 'i2cdisplaybus', 'locale', 'math', 'microcontroller', 'neopixel_write', 'nvm', 'onewireio',
      'os', 'paralleldisplaybus', 'pulseio', 'pwmio', 'random', 'rotaryio', 'rtc', 'storage', 'struct',
      'supervisor', 'sys', 'terminalio', 'time', 'touchio', 'usb_cdc', 'usb_hid', 'usb_midi', 'warnings'];
    const code = `for name in ${JSON.stringify(real)}:
    try:
        __import__(name)
    except ImportError:
        print("MISSING", name)
help("modules")
`;
    const output = await runCode(code);
    const missing = [...output.matchAll(/MISSING (\w+)/g)].map((match) => match[1]);
    const listed = output.split('code.py output:')[1].split('Plus any modules')[0];
    const words = new Set(listed.match(/[\w.]+/g));
    const extra = [...words].filter((word) => !real.includes(word) && !word.startsWith('_') && !/^(code|code\.py|py|output|gc|micropython)$/.test(word)
      && !missing.includes(word) && /^[a-z]/.test(word));
    return `${real.length - missing.length}/${real.length} present. Missing: ${missing.join(', ')}. Extra: ${extra.join(', ') || 'none'}`;
  },

  async 'speed compared with real time'() {
    const output = await runCode(`import time
start = time.monotonic()
i = 0
while i < 1000000:
    i += 1
elapsed = time.monotonic() - start
print("loop", round(1000000 / elapsed))
`, { timeoutMs: 60000 });
    return output.match(/loop \d+/)[0] + ' iterations per second';
  },

  async 'cold start time'() {
    const started = performance.now();
    await runCode('print("up")\n', { until: 'up' });
    return `${(performance.now() - started).toFixed(0)}ms from create to first output`;
  },
};

async function lcdCheck(kind) {
  const code = `import board, digitalio
import adafruit_character_lcd.character_lcd as character_lcd
pins = [digitalio.DigitalInOut(p) for p in (board.D7, board.D8, board.D9, board.D10, board.D11, board.D12)]
lcd = character_lcd.Character_LCD_Mono(*pins, 16, 2)
lcd.message = "Hello, Metro!\\nCircuitPython"
print("lcd done")
`;
  const board = new Board({
    files: { '/code.py': code, ...libFiles(kind, ['adafruit_character_lcd']) },
    partsModule: PARTS,
    partsConfig: { lcd: { rs: PINS.D7, en: PINS.D8, d4: PINS.D9, d5: PINS.D10, d6: PINS.D11, d7: PINS.D12 } },
  });
  const screens = [];
  board.on('lcd', ({ lines }) => screens.push(lines));
  await board.waitForOutput('Code done running', 15000);
  await board.stop();
  expectContains(board.output, 'lcd done');
  const last = screens.at(-1) ?? [];
  if (last[0]?.trim() !== 'Hello, Metro!' || last[1]?.trim() !== 'CircuitPython') {
    throw new Error(`Screen ${JSON.stringify(last)}\n${board.output}`);
  }
  return `screen shows "${last[0].trim()}" / "${last[1].trim()}"`;
}

(async () => {
  const filter = process.argv[2]?.toLowerCase();
  let failed = 0;
  for (const [name, check] of Object.entries(checks)) {
    if (filter && !name.toLowerCase().includes(filter)) continue;
    try {
      const detail = await check();
      console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
    } catch (error) {
      failed++;
      console.log(`FAIL  ${name}\n      ${String(error.message).replace(/\n/g, '\n      ')}`);
    }
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
