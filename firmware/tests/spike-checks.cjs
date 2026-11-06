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
    if (missing.length || extra.length) throw new Error(`Missing: ${missing.join(', ')}. Extra: ${extra.join(', ')}`);
    return `${real.length}/${real.length} present, nothing extra`;
  },

  async 'nvm reads, writes and keeps its data'() {
    const seed = new Uint8Array(256).fill(0xff);
    seed[5] = 42;
    const code = `import microcontroller, nvm
store = microcontroller.nvm
print("type", type(store) is nvm.ByteArray, "length", len(store))
print("seed", store[5], store[6])
store[0:3] = b"abc"
store[10] = 200
print("read", bytes(store[0:4]), store[10], store[255])
try:
    store[256] = 1
except IndexError as error:
    print("index", error)
try:
    store[0:2] = b"abc"
except (ValueError, NotImplementedError) as error:
    print("length", error)
`;
    const board = new Board({ files: { '/code.py': code }, nvm: seed });
    const writes = [];
    board.on('nvmWrite', ({ offset, data }) => writes.push([offset, [...data]]));
    await board.waitForOutput('Code done running');
    await sleep(50);
    await board.stop();
    expectContains(board.output, 'type True length 256');
    expectContains(board.output, 'seed 42 255');
    expectContains(board.output, "read b'abc\\xff' 200 255");
    expectContains(board.output, 'index ');
    if (JSON.stringify(writes.slice(0, 2)) !== '[[0,[97,98,99]],[10,[200]]]') throw new Error(JSON.stringify(writes));
    return `${writes.length} writes reached the host`;
  },

  async 'rtc starts in 2000 and can be set'() {
    const code = `import rtc, time
clock = rtc.RTC()
print("start", clock.datetime.tm_year, clock.datetime.tm_mon, clock.datetime.tm_mday)
clock.datetime = time.struct_time((2024, 3, 17, 21, 1, 47, 0, -1, -1))
now = time.localtime()
print("set", now.tm_year, now.tm_mon, now.tm_mday, now.tm_hour, now.tm_min, now.tm_wday, now.tm_yday)
print("time", time.time())
time.sleep(1.1)
print("later", time.localtime().tm_sec >= 48)
print("calibration", clock.calibration)
clock.calibration = -5
print("calibration", clock.calibration)
try:
    clock.calibration = 200
except ValueError as error:
    print("range", error)
`;
    const board = new Board({ files: { '/code.py': code } });
    let seconds;
    board.on('rtcSet', (message) => { seconds = message.seconds; });
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'start 2000 1 1');
    expectContains(board.output, 'set 2024 3 17 21 1 6 77');
    expectContains(board.output, 'later True');
    expectContains(board.output, 'calibration -5');
    expectContains(board.output, 'range calibration must be -127-127');
    if (seconds !== 1710709307) throw new Error(`rtcSet ${seconds}\n${board.output}`);
    const clockTime = Number(board.output.match(/time (\d+)/)[1]);
    if (Math.abs(clockTime - seconds) > 1) throw new Error(`time.time() ${clockTime}`);
    return 'localtime, time.time and rtcSet agree';
  },

  async 'files get the rtc time as their timestamp'() {
    const output = await runCode(`import os, rtc, storage, time
print("stat", os.stat("/code.py")[8] > 0)
`, { options: { rtcStart: 1710709307 } });
    expectContains(output, 'stat True');
  },

  async 'touchio follows the real threshold rules'() {
    const code = `import board, time, touchio
pad = touchio.TouchIn(board.A1)
print("baseline", pad.raw_value, pad.threshold, pad.value)
print("wait")
while not pad.value:
    time.sleep(0.01)
print("touched", pad.raw_value)
pad.threshold = 60000
print("high threshold", pad.value)
for pin in (board.D13, board.D4, board.SDA):
    try:
        touchio.TouchIn(pin)
    except ValueError as error:
        print("bad pin", error)
`;
    const board = new Board({ files: { '/code.py': code } });
    board.setTouch(PINS.A1, 1000);
    await board.waitForOutput('wait');
    expectContains(board.output, 'baseline 1000 1100 False');
    board.setTouch(PINS.A1, 1100);
    await sleep(60);
    if (board.output.includes('touched')) throw new Error('A reading equal to the threshold counted as touched');
    board.setTouch(PINS.A1, 1101);
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'touched 1101');
    expectContains(board.output, 'high threshold False');
    if (board.output.match(/bad pin Invalid pin/g)?.length !== 3) throw new Error(board.output);
  },

  async 'touch pins match the chip'() {
    const output = await runCode(`import board, touchio
for name in ("A0", "A1", "A2", "A3", "A4", "A5", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13"):
    try:
        pad = touchio.TouchIn(getattr(board, name))
        pad.deinit()
        print("touch", name)
    except ValueError:
        pass
`);
    const pins = [...output.matchAll(/touch (\w+)/g)].map((match) => match[1]).join(' ');
    // Y lines exist on PA02-PA07, PB02, PB03, PB08 and PB09. PA06 and PA07 are D8 and D9.
    if (pins !== 'A0 A1 A2 A3 A4 A5 D8 D9') throw new Error(pins);
    return pins;
  },

  async 'rotaryio counts detents with the divisor'() {
    const code = `import board, rotaryio, time
knob = rotaryio.IncrementalEncoder(board.D2, board.D3)
print("start", knob.position, knob.divisor)
def settle(label):
    print("step", label)
    time.sleep(0.15)
    print("pos", label, knob.position)
settle("a")
settle("b")
settle("c")
knob.position = 100
settle("d")
knob.divisor = 1
settle("e")
knob.divisor = 2
settle("f")
`;
    const board = new Board({ files: { '/code.py': code } });
    const turn = async (label, edges) => {
      await board.waitForOutput(`step ${label}`);
      board.turnEncoder(PINS.D2, edges);
    };
    await turn('a', 4);
    await turn('b', 3);
    await turn('c', -12);
    await turn('d', 8);
    await turn('e', -3);
    await turn('f', 5);
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'start 0 4');
    expectContains(board.output, 'pos a 1');
    expectContains(board.output, 'pos b 1'); // Three of the four edges for the next detent.
    expectContains(board.output, 'pos c -1'); // The shared decoder keeps those edges in sub_count.
    expectContains(board.output, 'pos d 101'); // Worked through by hand against shared-module/rotaryio.
    expectContains(board.output, 'pos e 100');
    expectContains(board.output, 'pos f 102');
  },

  async 'rotaryio and pulseio validate pins and interrupts'() {
    const output = await runCode(`import board, pulseio, rotaryio
try:
    rotaryio.IncrementalEncoder(board.D4, board.D5)
except ValueError as error:
    print("a", error)
try:
    rotaryio.IncrementalEncoder(board.D5, board.D4)
except ValueError as error:
    print("b", error)
try:
    pulseio.PulseIn(board.D4)
except ValueError as error:
    print("c", error)
knob = rotaryio.IncrementalEncoder(board.A0, board.A1)
try:
    pulseio.PulseIn(board.D10)
except RuntimeError as error:
    print("d", error)
try:
    rotaryio.IncrementalEncoder(board.D10, board.D2)
except RuntimeError as error:
    print("e", error)
knob.deinit()
pulses = pulseio.PulseIn(board.D10)
print("freed", len(pulses))
`);
    expectContains(output, 'a Invalid pin_a pin');
    expectContains(output, 'b Invalid pin_b pin');
    expectContains(output, 'c Invalid pin');
    expectContains(output, 'd Internal resource(s) in use');
    expectContains(output, 'e Internal resource(s) in use');
    expectContains(output, 'freed 0');
  },

  async 'PulseIn keeps the real ring buffer'() {
    const code = `import board, pulseio, time
pulses = pulseio.PulseIn(board.D5, maxlen=4, idle_state=True)
print("empty", len(pulses), pulses.maxlen, pulses.paused, bool(pulses))
try:
    pulses.popleft()
except IndexError as error:
    print("pop", error)
try:
    pulses[0]
except IndexError as error:
    print("index", error)
print("wait 1")
while len(pulses) < 3:
    pass
print("three", pulses[0], pulses[1], pulses[2], pulses[-1], bool(pulses))
print("pop", pulses.popleft(), len(pulses))
try:
    pulses[0:1]
except NotImplementedError as error:
    print("slice", error)
try:
    pulses[0] = 1
except AttributeError as error:
    print("store", error)
pulses.clear()
print("cleared", len(pulses))
print("wait 2")
time.sleep(0.15)
print("wrapped", len(pulses), [pulses[i] for i in range(len(pulses))])
pulses.pause()
print("paused", pulses.paused)
print("wait 3")
time.sleep(0.15)
print("ignored", [pulses[i] for i in range(len(pulses))])
pulses.clear()
pulses.resume()
print("resumed", pulses.paused)
print("wait 4")
time.sleep(0.15)
print("capped", pulses[0])
pulses.deinit()
try:
    len(pulses)
except ValueError as error:
    print("deinit", error)
`;
    const board = new Board({ files: { '/code.py': code } });
    await board.waitForOutput('wait 1');
    board.sendPulses(PINS.D5, [100, 200, 300]);
    await board.waitForOutput('wait 2');
    board.sendPulses(PINS.D5, [1, 2, 3, 4, 5, 6]);
    await board.waitForOutput('wait 3');
    board.sendPulses(PINS.D5, [7, 8]);
    await board.waitForOutput('wait 4');
    board.sendPulses(PINS.D5, [70000]);
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'empty 0 4 False False');
    expectContains(board.output, 'pop pop from empty PulseIn');
    expectContains(board.output, 'index index out of range');
    expectContains(board.output, 'three 100 200 300 300 True');
    expectContains(board.output, 'pop 100 2');
    expectContains(board.output, 'slice Slices not supported');
    expectContains(board.output, 'store Read-only');
    expectContains(board.output, 'cleared 0');
    expectContains(board.output, 'wrapped 4 [3, 4, 5, 6]');
    expectContains(board.output, 'paused True');
    expectContains(board.output, 'ignored [3, 4, 5, 6]');
    expectContains(board.output, 'resumed False');
    expectContains(board.output, 'capped 65535');
    expectContains(board.output, 'deinit Object has been deinitialized');
  },

  async 'PulseIn trigger pulse and the too-long error'() {
    const code = `import board, pulseio, time
pulses = pulseio.PulseIn(board.D5, maxlen=8, idle_state=True)
pulses.pause()
pulses.clear()
pulses.resume(500)
print("resumed", pulses.paused)
print("wait")
time.sleep(0.15)
print("stopped", pulses.paused, len(pulses))
try:
    pulses.popleft()
except RuntimeError as error:
    print("error", error)
print("after", pulses.popleft(), len(pulses))
`;
    const board = new Board({ files: { '/code.py': code } });
    const levels = [];
    let trigger;
    board.on('pin', ({ pin, value, at }) => pin === PINS.D5 && levels.push([value, at]));
    board.on('pulseinResume', ({ triggerMicros }) => { trigger = triggerMicros; });
    await board.waitForOutput('wait');
    // Over 349.5ms after the buffer was last empty, the real driver stops with an error.
    board.sendPulses(PINS.D5, [60000, 60000, 60000, 60000, 60000, 60000, 60000]);
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'resumed False');
    expectContains(board.output, 'stopped True 6');
    expectContains(board.output, 'error Input taking too long');
    expectContains(board.output, 'after 60000 5');
    if (trigger !== 500 || levels.length !== 2 || levels[0][0] !== 0 || levels[1][0] !== 1) {
      throw new Error(`Trigger ${trigger}, levels ${JSON.stringify(levels)}`);
    }
    const width = (levels[1][1] - levels[0][1]) * 1000;
    if (width < 490) throw new Error(`Trigger pulse lasted ${width}us`);
    return `trigger pulse lasted ${width.toFixed(0)}us`;
  },

  async 'PulseOut blocks for the whole send'() {
    const code = `import array, board, pulseio, time
out = pulseio.PulseOut(board.D9, frequency=38000, duty_cycle=32768)
pulses = array.array("H", [30000, 10000, 20000])
start = time.monotonic_ns()
out.send(pulses)
print("took", (time.monotonic_ns() - start) // 1000)
try:
    out.send(array.array("B", [1, 2]))
except TypeError as error:
    print("type", error)
out.deinit()
for pin in (board.A0, board.A5):
    try:
        pulseio.PulseOut(pin)
    except ValueError as error:
        print("pin", error)
`;
    const board = new Board({ files: { '/code.py': code } });
    let sent;
    const pwm = [];
    board.on('pulseout', (message) => { sent = message; });
    board.on('pwm', ({ pin, duty }) => pin === PINS.D9 && pwm.push(duty));
    await board.waitForOutput('Code done running');
    await board.stop();
    const took = Number(board.output.match(/took (\d+)/)[1]);
    if (took < 59000 || took > 75000) throw new Error(`Took ${took}us\n${board.output}`);
    if (sent.pin !== PINS.D9 || sent.frequency !== 38004 || sent.dutyCycle !== 32768 || [...sent.pulses].join() !== '30000,10000,20000') {
      throw new Error(JSON.stringify(sent));
    }
    if (pwm.at(-1) !== 0) throw new Error(`The carrier must stay off between sends: ${pwm}`);
    expectContains(board.output, "type Array must contain halfwords (type 'H')");
    if (board.output.match(/pin Invalid pin/g)?.length !== 2) throw new Error(board.output);
    return `60000us of pulses took ${took}us`;
  },

  async 'Stop interrupts a long PulseOut send'() {
    const code = `import array, board, pulseio
out = pulseio.PulseOut(board.D9)
print("start")
for i in range(100):
    out.send(array.array("H", [65000] * 9))
`;
    const board = new Board({ files: { '/code.py': code } });
    await board.waitForOutput('start');
    await sleep(100);
    const stoppedAt = performance.now();
    board.write('\x03');
    await board.waitForOutput('KeyboardInterrupt', 3000);
    const elapsed = performance.now() - stoppedAt;
    await board.stop();
    return `stopped in ${elapsed.toFixed(0)}ms`;
  },

  async 'unmodified library: DS18B20 over onewireio'() {
    const code = `import board, time
from adafruit_onewire.bus import OneWireBus
import adafruit_ds18x20
bus = OneWireBus(board.D6)
print("reset", bus.reset())
found = bus.scan()
print("found", len(found), [hex(b) for b in found[0].rom] if found else None)
sensor = adafruit_ds18x20.DS18X20(bus, found[0])
print("temperature", sensor.temperature)
`;
    const board = new Board({
      files: { '/code.py': code, ...libFiles('mpy', ['adafruit_onewire', 'adafruit_ds18x20.mpy']) },
      partsModule: PARTS, partsConfig: { ds18b20: { pin: PINS.D6, celsius: 21.5 } },
    });
    await board.waitForOutput('Code done running', 15000);
    await board.stop();
    expectContains(board.output, 'reset True');
    expectContains(board.output, 'found 1');
    expectContains(board.output, 'temperature 21.5');
  },

  async 'OneWire reset reports an empty bus'() {
    const output = await runCode(`import board, onewireio
bus = onewireio.OneWire(board.D6)
print("error", bus.reset())
`);
    expectContains(output, 'error True');
  },

  async 'busio.SPI follows the real SERCOM pad rules'() {
    const output = await runCode(`import board, busio
def attempt(label, *args):
    try:
        bus = busio.SPI(*args)
        print(label, "ok")
        bus.deinit()
    except ValueError as error:
        print(label, error)
attempt("header", board.SCK, board.MOSI, board.MISO)
attempt("d13", board.D13, board.D11, board.D12)
attempt("clockpad", board.D2, board.D3)
attempt("mosipad", board.D13, board.D10)
attempt("nosercom", board.A0, board.D11)
attempt("mismatch", board.SCK, board.D11)
attempt("misoonly", board.SCK, None, board.MISO)
bus = busio.SPI(board.SCK, board.MOSI)
while not bus.try_lock():
    pass
print("start", bus.frequency)
bus.configure(baudrate=1000000)
print("rate", bus.frequency)
bus.configure(baudrate=7000000)
print("rate", bus.frequency)
bus.configure(baudrate=100000000)
print("rate", bus.frequency)
bus.unlock()
bus.deinit()
first = busio.SPI(board.D13, board.D11)
second = None
try:
    second = busio.SPI(board.D3, board.D4)
except ValueError as error:
    print("second", error)
`);
    expectContains(output, 'header ok');
    expectContains(output, 'd13 ok');
    expectContains(output, 'clockpad Invalid pins');
    expectContains(output, 'mosipad Invalid pins');
    expectContains(output, 'nosercom Invalid pins');
    expectContains(output, 'mismatch Invalid pins');
    expectContains(output, 'misoonly ok');
    expectContains(output, 'start 250000');
    expectContains(output, 'rate 1000000');
    expectContains(output, 'rate 6000000'); // A ceiling: the nearest lower available rate.
    expectContains(output, 'rate 24000000');
  },

  async 'busio.UART follows the real SERCOM pad rules'() {
    const output = await runCode(`import board, busio
def attempt(label, tx, rx, **options):
    try:
        bus = busio.UART(tx, rx, **options)
        print(label, "ok")
        bus.deinit()
    except (ValueError, NotImplementedError) as error:
        print(label, error)
attempt("header", board.TX, board.RX)
attempt("txonly", board.TX, None)
attempt("rxonly", None, board.RX)
attempt("txpad", board.D0, board.D1)
attempt("mismatch", board.TX, board.D2)
attempt("nosercom", board.A0, board.RX)
attempt("bits", board.TX, board.RX, bits=9)
attempt("buffer", board.TX, board.RX, receiver_buffer_size=100)
`);
    expectContains(output, 'header ok');
    expectContains(output, 'txonly ok');
    expectContains(output, 'rxonly ok');
    expectContains(output, 'txpad Invalid pins');
    expectContains(output, 'mismatch Invalid pins');
    expectContains(output, 'nosercom Invalid pins');
    expectContains(output, 'bits bits must be <= 8');
    expectContains(output, 'buffer receiver_buffer_size must be power of 2');
  },

  async 'SERCOM5 belongs to the flash and each SERCOM has one user'() {
    const output = await runCode(`import board, busio, digitalio, microcontroller
for pin in (microcontroller.pin.PB22, microcontroller.pin.PA13):
    try:
        digitalio.DigitalInOut(pin)
    except ValueError as error:
        print("flash", error)
one = busio.I2C(board.SCL, board.SDA)
try:
    two = busio.SPI(board.SCK, board.MOSI)
    three = busio.UART(board.D6, board.D7)
    print("third", "ok")
except ValueError as error:
    print("third", error)
one.deinit()
second = busio.UART(board.D6, board.D7)
print("freed ok")
`);
    // D6 and D7 reach SERCOM3 and SERCOM5. I2C has SERCOM3 and the flash has SERCOM5.
    expectContains(output, 'flash PB22 in use');
    expectContains(output, 'flash PA13 in use');
    expectContains(output, 'third Invalid pins');
    expectContains(output, 'freed ok');
  },

  async 'UART receives into a ring and paces writes'() {
    const code = `import board, busio, time
uart = busio.UART(board.TX, board.RX, baudrate=9600, timeout=0.05)
print("wait 1")
time.sleep(0.1)
print("waiting", uart.in_waiting)
print("read", uart.read(3), uart.read(10), uart.read(1))
buffer = bytearray(2)
print("wait 2")
time.sleep(0.1)
print("into", uart.readinto(buffer), bytes(buffer))
print("line", uart.readline())
print("wait 3")
time.sleep(0.1)
print("overflow", uart.in_waiting, uart.read(1))
uart.reset_input_buffer()
print("reset", uart.in_waiting)
start = time.monotonic_ns()
uart.write(b"x" * 96)
print("wrote", (time.monotonic_ns() - start) // 1000000)
try:
    busio.UART(None, board.D2).write(b"x")
except ValueError as error:
    print("no tx", error)
`;
    const board = new Board({ files: { '/code.py': code } });
    const sent = [];
    board.on('uart', ({ tx, data }) => sent.push([tx, data.length]));
    await board.waitForOutput('wait 1');
    board.sendUart(PINS.D0, Buffer.from('hello'));
    await board.waitForOutput('wait 2');
    board.sendUart(PINS.D0, Buffer.from('ABok\n'));
    await board.waitForOutput('wait 3');
    board.sendUart(PINS.D0, Array.from({ length: 100 }, (_, i) => i));
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'waiting 5');
    expectContains(board.output, "read b'hel' b'lo' None");
    expectContains(board.output, "into 2 b'AB'");
    expectContains(board.output, "line b'ok\\n'");
    expectContains(board.output, "overflow 64 b'$'"); // Only the newest 64 of 100 bytes remain.
    expectContains(board.output, 'reset 0');
    expectContains(board.output, 'no tx No tx pin');
    const wrote = Number(board.output.match(/wrote (\d+)/)[1]);
    if (wrote < 95 || wrote > 115) throw new Error(`96 bytes at 9600 baud took ${wrote}ms`);
    if (sent[0][0] !== PINS.D1 || sent[0][1] !== 96) throw new Error(JSON.stringify(sent));
    return `96 bytes at 9600 baud took ${wrote}ms`;
  },

  async 'PWM timers are shared like the real chip'() {
    const output = await runCode(`import board, pwmio
def make(label, pin, **options):
    try:
        out = pwmio.PWMOut(pin, **options)
        print(label, "ok", out.frequency)
        return out
    except (ValueError, RuntimeError) as error:
        print(label, type(error).__name__, error)
a = make("first", board.D9, frequency=500)
b = make("samefreq", board.D8, frequency=500)
c = make("otherfreq", board.A4, frequency=1000)
a.deinit()
b.deinit()
d = make("different", board.D9, frequency=500)
e = make("clash", board.D8, frequency=1000)
d.deinit()
f = make("nopwm", board.A5)
g = make("zero", board.D9, frequency=0)
h = make("fast", board.D9, frequency=25000000)
v = make("variable", board.D9, frequency=500, variable_frequency=True)
print("share", make("shared", board.D8, frequency=500))
v.frequency = 1234
print("changed", v.frequency, v.duty_cycle)
v.duty_cycle = 1000
print("duty", v.duty_cycle)
v.deinit()
u = make("wave0", board.A1)
t = make("rounded", board.A2, frequency=12345)
t.duty_cycle = 1000
print("duty", t.duty_cycle)
`);
    expectContains(output, 'first ok 500');
    expectContains(output, 'samefreq ok 500');
    expectContains(output, 'otherfreq ok 1000'); // A4 is on TCC0, so it is free to differ.
    expectContains(output, 'different ok 500');
    expectContains(output, 'clash RuntimeError Conflicting settings for shared resource');
    expectContains(output, 'nopwm ValueError Invalid pin');
    expectContains(output, 'zero ValueError Invalid frequency');
    expectContains(output, 'fast ValueError Invalid frequency');
    expectContains(output, 'variable ok 500');
    expectContains(output, 'shared RuntimeError Conflicting settings for shared resource');
    expectContains(output, 'changed 1234');
    expectContains(output, 'duty 999'); // The real period and compare arithmetic loses a little.
    expectContains(output, 'wave0 RuntimeError Conflicting settings for shared resource');
    return output.match(/rounded.*/)[0];
  },

  async 'displayio draws through FourWire and BusDisplay'() {
    const code = `import board, busdisplay, busio, digitalio, displayio, fourwire
displayio.release_displays()
spi = busio.SPI(board.SCK, board.MOSI)
bus = fourwire.FourWire(spi, command=board.D9, chip_select=board.D10, reset=board.D8)
init = bytes((0x01, 0x80, 0x05, 0x11, 0x80, 0x05, 0x3a, 0x01, 0x05, 0x29, 0x80, 0x05))
display = busdisplay.BusDisplay(bus, init, width=32, height=16, auto_refresh=False)
report = digitalio.DigitalInOut(board.D2)
report.switch_to_output(False)
palette = displayio.Palette(2)
palette[0] = 0x000000
palette[1] = 0xff0000
bitmap = displayio.Bitmap(32, 16, 2)
for x in range(8, 16):
    for y in range(4, 8):
        bitmap[x, y] = 1
root = displayio.Group()
root.append(displayio.TileGrid(bitmap, pixel_shader=palette))
display.root_group = root
print("refreshed", display.refresh())
report.value = True
print("drawn")
`;
    const board = new Board({
      files: { '/code.py': code },
      partsModule: PARTS,
      partsConfig: { spiDisplay: { dc: PINS.D9, width: 32, height: 16, reportPin: PINS.D2 } },
    });
    const frame = new Promise((resolve) => board.on('display', resolve));
    await board.waitForOutput('drawn');
    const { pixels, width, commands } = await frame;
    await board.stop();
    let red = 0;
    let misplaced = 0;
    pixels.forEach((value, i) => {
      const x = i % width;
      const y = Math.floor(i / width);
      const inside = x >= 8 && x < 16 && y >= 4 && y < 8;
      if (value === 0xf800) red++;
      if ((value === 0xf800) !== inside) misplaced++;
    });
    if (red !== 32 || misplaced) throw new Error(`${red} red pixels, ${misplaced} misplaced`);
    if (!commands.includes(0x29) || !commands.includes(0x2c)) throw new Error(commands.join());
    return `${red} red pixels in the right place`;
  },

  async 'unmodified libraries: SSD1306 OLED with text'() {
    const code = `import board, displayio, i2cdisplaybus, terminalio
import adafruit_displayio_ssd1306
from adafruit_display_text import label
displayio.release_displays()
bus = i2cdisplaybus.I2CDisplayBus(board.I2C(), device_address=0x3c)
display = adafruit_displayio_ssd1306.SSD1306(bus, width=128, height=32, auto_refresh=False)
root = displayio.Group()
root.append(label.Label(terminalio.FONT, text="Hello", color=0xffffff, x=2, y=8))
display.root_group = root
display.refresh()
import gc
gc.collect()
print("free", gc.mem_free())
print("drawn")
`;
    const board = new Board({
      files: {
        '/code.py': code, ...libFiles('mpy', ['adafruit_displayio_ssd1306.mpy', 'adafruit_display_text']),
      },
      partsModule: PARTS, partsConfig: { i2cOled: true },
    });
    let oled;
    board.on('oled', (message) => { oled = message; });
    await board.waitForOutput('Code done running', 15000);
    await sleep(100);
    await board.stop();
    if (!board.output.includes('drawn')) return `MemoryError or other failure:\n${board.output}`;
    if (!oled || oled.commands < 5 || oled.dataBytes < 400 || oled.lit < 30) {
      throw new Error(`${JSON.stringify(oled)}\n${board.output}`);
    }
    return `${oled.dataBytes} data bytes, ${oled.lit} pixels lit, ${board.output.match(/free \d+/)[0]}`;
  },

  async 'terminalio shows the console on a display'() {
    const code = `import board, busdisplay, busio, digitalio, displayio, fourwire, terminalio
displayio.release_displays()
spi = busio.SPI(board.SCK, board.MOSI)
bus = fourwire.FourWire(spi, command=board.D9, chip_select=board.D10)
init = bytes((0x11, 0x80, 0x05, 0x3a, 0x01, 0x05, 0x29, 0x80, 0x05))
display = busdisplay.BusDisplay(bus, init, width=160, height=80, auto_refresh=False)
report = digitalio.DigitalInOut(board.D2)
report.switch_to_output(False)
print("font", terminalio.FONT.get_bounding_box())
print("terminal text on the screen")
display.refresh()
report.value = True
print("drawn")
`;
    const board = new Board({
      files: { '/code.py': code },
      partsModule: PARTS,
      partsConfig: { spiDisplay: { dc: PINS.D9, width: 160, height: 80, reportPin: PINS.D2 } },
    });
    const frame = new Promise((resolve) => board.on('display', resolve));
    await board.waitForOutput('drawn');
    const { pixels } = await frame;
    await board.stop();
    expectContains(board.output, 'font (6, 12');
    const lit = pixels.reduce((count, value) => count + (value ? 1 : 0), 0);
    if (lit < 100) throw new Error(`Only ${lit} pixels lit`);
    return `${lit} pixels of console text`;
  },

  async 'display survives a reload and releases its pins'() {
    const code = `import board, busdisplay, busio, displayio, fourwire
displayio.release_displays()
spi = busio.SPI(board.SCK, board.MOSI)
bus = fourwire.FourWire(spi, command=board.D9, chip_select=board.D10)
init = bytes((0x11, 0x80, 0x05))
display = busdisplay.BusDisplay(bus, init, width=32, height=16)
print("made one")
`;
    const board = new Board({ files: { '/code.py': code } });
    await board.waitForOutput('Code done running');
    board.output = '';
    board.write('\x04');
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'made one');
    if (board.output.includes('Error')) throw new Error(board.output);
  },

  async 'ParallelBus checks pins and sends bytes'() {
    const code = `import board, busdisplay, displayio, microcontroller, paralleldisplaybus
displayio.release_displays()
try:
    paralleldisplaybus.ParallelBus(data0=board.D0, command=board.A1, chip_select=board.A2, write=board.A3)
except ValueError as error:
    print("align", error)
try:
    paralleldisplaybus.ParallelBus(data0=board.D0, command=board.A1, chip_select=board.A2, write=board.A3)
except RuntimeError as error:
    print("slot", error)
displayio.release_displays()
try:
    paralleldisplaybus.ParallelBus(data_pins=[board.D0], command=board.A1, chip_select=board.A2, write=board.A3)
except (ValueError, NotImplementedError) as error:
    print("list", error)
displayio.release_displays()
bus = paralleldisplaybus.ParallelBus(data0=microcontroller.pin.PA16, command=board.A1, chip_select=board.A2,
    write=board.A3, reset=board.A4)
bus.send(0x2a, bytes(4))
print("sent")
`;
    const board = new Board({ files: { '/code.py': code }, partsModule: PARTS, partsConfig: { parallelDisplay: true } });
    let received;
    board.on('parallel', (message) => { received = message; });
    await board.waitForOutput('Code done running');
    await sleep(50);
    await board.stop();
    expectContains(board.output, 'align Data 0 pin must be byte aligned');
    expectContains(board.output, 'slot Too many display busses');
    expectContains(board.output, 'sent');
    if (received?.bytes !== 5 || received.data0 !== 16) throw new Error(`${JSON.stringify(received)}\n${board.output}`);
    return board.output.match(/list.*/)?.[0];
  },

  async 'AudioOut plays a RawSample for its real length'() {
    const code = `import array, audiocore, audioio, board, time
samples = array.array("h", [1000, -1000, 2000, -2000] * 400)
sample = audiocore.RawSample(samples, sample_rate=8000)
speaker = audioio.AudioOut(board.A0)
print("before", speaker.playing)
start = time.monotonic_ns()
speaker.play(sample)
print("playing", speaker.playing, speaker.paused)
while speaker.playing:
    pass
print("took", (time.monotonic_ns() - start) // 1000000)
`;
    const board = new Board({ files: { '/code.py': code } });
    const written = [];
    const events = [];
    board.on('audioStart', (message) => events.push(['start', message.pin, message.sampleRate, message.channels]));
    board.on('audioWrite', ({ samples }) => written.push(...samples));
    board.on('audioStop', ({ pin }) => events.push(['stop', pin]));
    await board.waitForOutput('Code done running');
    await sleep(100);
    await board.stop();
    expectContains(board.output, 'before False');
    expectContains(board.output, 'playing True False');
    const took = Number(board.output.match(/took (\d+)/)[1]);
    if (took < 195 || took > 240) throw new Error(`1600 samples at 8kHz took ${took}ms`);
    if (written.length !== 1600 || written.slice(0, 4).join() !== '1000,-1000,2000,-2000') {
      throw new Error(`${written.length}: ${written.slice(0, 8)}`);
    }
    if (JSON.stringify(events) !== `[["start",${PINS.A0},8000,1],["stop",${PINS.A0}]]`) throw new Error(JSON.stringify(events));
    return `1600 samples at 8kHz took ${took}ms`;
  },

  async 'AudioOut converts formats and plays one channel of stereo'() {
    const code = `import array, audiocore, audioio, board
speaker = audioio.AudioOut(board.A0)
def play(buffer, **options):
    speaker.play(audiocore.RawSample(buffer, sample_rate=44100, **options))
    while speaker.playing:
        pass
    print("next")
play(array.array("B", [0, 128, 255]))
play(array.array("b", [-128, 0, 127]))
play(array.array("H", [0, 32768, 65535]))
play(array.array("h", [1, 2, 3, 4, 5, 6]), channel_count=2)
print("finished")
`;
    const board = new Board({ files: { '/code.py': code } });
    const plays = [];
    board.on('audioStart', () => plays.push([]));
    board.on('audioWrite', ({ samples }) => plays.at(-1).push(...samples));
    await board.waitForOutput('finished');
    await sleep(100);
    await board.stop();
    const expected = [[-32768, 0, 32512], [-32768, 0, 32512], [-32768, 0, 32767], [1, 3, 5]];
    if (JSON.stringify(plays) !== JSON.stringify(expected)) throw new Error(JSON.stringify(plays));
  },

  async 'AudioOut plays a WAV file from CIRCUITPY'() {
    const rate = 22050;
    const count = 5000;
    const pcm = Buffer.alloc(count * 2);
    for (let i = 0; i < count; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 10)), i * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    const code = `import audiocore, audioio, board, time
wave = audiocore.WaveFile(open("/tone.wav", "rb"))
print("wave", wave.sample_rate, wave.channel_count, wave.bits_per_sample)
speaker = audioio.AudioOut(board.A0)
start = time.monotonic_ns()
speaker.play(wave)
ticks = 0
while speaker.playing:
    time.sleep(0.01)
    ticks += 1
print("took", (time.monotonic_ns() - start) // 1000000, ticks > 10)
`;
    const board = new Board({ files: { '/code.py': code, '/tone.wav': Buffer.concat([header, pcm]) } });
    const written = [];
    board.on('audioWrite', ({ samples }) => written.push(...samples));
    await board.waitForOutput('Code done running');
    await sleep(100);
    await board.stop();
    expectContains(board.output, `wave ${rate} 1 16`);
    if (written.length !== count) throw new Error(`Wrote ${written.length} of ${count}\n${board.output}`);
    const wrong = written.findIndex((value, i) => value !== pcm.readInt16LE(i * 2));
    if (wrong >= 0) throw new Error(`Sample ${wrong} is ${written[wrong]}`);
    const took = Number(board.output.match(/took (\d+)/)[1]);
    if (took < 220 || took > 275) throw new Error(`Took ${took}ms\n${board.output}`);
    return `${count} samples intact in ${took}ms, with Python still running`;
  },

  async 'AudioOut loops without running ahead, and pause and stop work'() {
    const code = `import array, audiocore, audioio, board, time
sample = audiocore.RawSample(array.array("h", [100, -100] * 50), sample_rate=8000)
speaker = audioio.AudioOut(board.A0)
speaker.play(sample, loop=True)
time.sleep(0.5)
print("looping", speaker.playing)
speaker.pause()
print("paused", speaker.paused, speaker.playing)
print("mark 1")
time.sleep(0.3)
print("mark 2")
speaker.resume()
print("resumed", speaker.paused, speaker.playing)
time.sleep(0.1)
speaker.stop()
print("stopped", speaker.playing, speaker.paused)
try:
    speaker.pause()
except RuntimeError as error:
    print("idle pause", error)
`;
    const board = new Board({ files: { '/code.py': code } });
    let samples = 0;
    let atMark1 = 0;
    let atMark2 = 0;
    const pauses = [];
    board.on('audioWrite', (message) => { samples += message.samples.length; });
    board.on('audioPause', ({ paused }) => pauses.push(paused));
    board.on('serial', (text) => {
      if (text.includes('mark 1')) atMark1 = samples;
      if (text.includes('mark 2')) atMark2 = samples;
    });
    await board.waitForOutput('Code done running');
    await sleep(100);
    await board.stop();
    expectContains(board.output, 'looping True');
    expectContains(board.output, 'paused True True');
    expectContains(board.output, 'resumed False True');
    expectContains(board.output, 'stopped False False');
    expectContains(board.output, 'idle pause Not playing');
    // 0.5s at 8kHz is 4000 samples, plus at most about 120ms queued ahead.
    if (atMark1 < 4000 || atMark1 > 5400) throw new Error(`${atMark1} samples sent in the first 0.5s`);
    if (atMark2 !== atMark1) throw new Error(`Sent ${atMark2 - atMark1} samples while paused`);
    if (pauses.join() !== 'true,false') throw new Error(pauses.join());
    return `${atMark1} samples sent for 4000 heard`;
  },

  async 'Stop interrupts audio and ends it'() {
    const code = `import array, audiocore, audioio, board
sample = audiocore.RawSample(array.array("h", [100, -100] * 50), sample_rate=8000)
speaker = audioio.AudioOut(board.A0)
speaker.play(sample, loop=True)
print("start")
while speaker.playing:
    pass
`;
    const board = new Board({ files: { '/code.py': code } });
    const stops = [];
    board.on('audioStop', ({ pin }) => stops.push(pin));
    await board.waitForOutput('start');
    await sleep(200);
    board.write('\x03');
    await board.waitForOutput('KeyboardInterrupt', 3000);
    await board.waitForOutput('Code done running', 3000);
    await sleep(50);
    await board.stop();
    if (stops.length !== 1) throw new Error(`audioStop called ${stops.length} times`);
  },

  async 'audio errors match the real board'() {
    const output = await runCode(`import analogio, array, audiocore, audiobusio, audioio, board
def attempt(label, make):
    try:
        print(label, "ok", make())
    except Exception as error:
        print(label, type(error).__name__, error)
attempt("wrong pin", lambda: audioio.AudioOut(board.A1))
attempt("right", lambda: audioio.AudioOut(board.A0, right_channel=board.A1))
dac = analogio.AnalogOut(board.A0)
attempt("dac busy", lambda: audioio.AudioOut(board.A1))
dac.deinit()
speaker = audioio.AudioOut(board.A0)
attempt("not a sample", lambda: speaker.play(5))
attempt("too fast", lambda: speaker.play(audiocore.RawSample(array.array("h", [1]), sample_rate=400000)))
speaker.deinit()
attempt("i2s clock", lambda: audiobusio.I2SOut(board.D2, board.D0, board.D9))
attempt("i2s word", lambda: audiobusio.I2SOut(board.D1, board.D2, board.D9))
attempt("i2s unit", lambda: audiobusio.I2SOut(board.SCK, board.D0, board.D9))
attempt("i2s data", lambda: audiobusio.I2SOut(board.D1, board.D0, board.D2))
attempt("pdm clock", lambda: audiobusio.PDMIn(board.D2, board.D9))
attempt("pdm data", lambda: audiobusio.PDMIn(board.D1, board.D2))
attempt("pdm depth", lambda: audiobusio.PDMIn(board.D1, board.D9, bit_depth=24))
attempt("pdm rate", lambda: audiobusio.PDMIn(board.D1, board.D9, sample_rate=8000))
`);
    expectContains(output, 'wrong pin ValueError Invalid pin');
    expectContains(output, 'right ValueError Right channel unsupported');
    expectContains(output, 'dac busy RuntimeError DAC already in use');
    expectContains(output, 'not a sample TypeError');
    expectContains(output, 'too fast ValueError sample_rate must be <= 350000');
    expectContains(output, 'i2s clock ValueError Invalid clock pin');
    expectContains(output, 'i2s word ValueError Invalid word_select pin');
    expectContains(output, 'i2s unit ValueError bit_clock and word_select must share a clock unit');
    expectContains(output, 'i2s data ValueError Invalid data pin');
    expectContains(output, 'pdm clock ValueError Invalid clock pin');
    expectContains(output, 'pdm data ValueError Invalid data pin');
    expectContains(output, 'pdm depth NotImplementedError Only 8 or 16 bit mono with 64x oversampling supported.');
    expectContains(output, 'pdm rate ValueError sampling rate out of range');
  },

  async 'I2SOut sends interleaved stereo'() {
    const code = `import array, audiobusio, audiocore, board
speaker = audiobusio.I2SOut(board.D1, board.D0, board.D9)
speaker.play(audiocore.RawSample(array.array("h", [1, 2, 3, 4]), sample_rate=8000, channel_count=2))
while speaker.playing:
    pass
speaker.play(audiocore.RawSample(array.array("h", [5, 6]), sample_rate=8000))
print("mono", speaker.playing)
speaker.stop()
print("again", speaker.playing)
speaker.deinit()
speaker = audiobusio.I2SOut(board.D1, board.D0, board.D9)
print("reused")
`;
    const board = new Board({ files: { '/code.py': code } });
    const starts = [];
    const written = [];
    board.on('i2sStart', ({ pin, sampleRate, channels }) => starts.push([pin, sampleRate, channels]));
    board.on('i2sWrite', ({ samples }) => written.push(...samples));
    await board.waitForOutput('Code done running');
    await sleep(100);
    await board.stop();
    expectContains(board.output, 'mono True');
    expectContains(board.output, 'again False');
    expectContains(board.output, 'reused');
    if (JSON.stringify(starts) !== `[[${PINS.D9},8000,2],[${PINS.D9},8000,1]]`) throw new Error(JSON.stringify(starts));
    if (written.join() !== '1,2,3,4,5,6') throw new Error(written.join());
  },

  async 'PDMIn records for the real length'() {
    const output = await runCode(`import array, audiobusio, board, time
mic = audiobusio.PDMIn(board.D1, board.D9, sample_rate=16000, bit_depth=16)
print("rate", mic.sample_rate)
samples = array.array("H", [0] * 1600)
start = time.monotonic_ns()
print("count", mic.record(samples, len(samples)))
print("took", (time.monotonic_ns() - start) // 1000000)
print("range", min(samples), max(samples))
try:
    mic.record(bytearray(10), 10)
except ValueError as error:
    print("type", error)
mic.deinit()
mic = audiobusio.PDMIn(board.D1, board.D9, sample_rate=16000, bit_depth=8)
small = bytearray(100)
print("count", mic.record(small, 100), min(small) > 60, max(small) < 200)
`);
    expectContains(output, 'rate 15957'); // The real clock divisor makes 16000 impossible.
    expectContains(output, 'count 1600');
    expectContains(output, "type destination buffer must be an array of type 'H' for bit_depth = 16");
    expectContains(output, 'count 100 True True');
    const took = Number(output.match(/took (\d+)/)[1]);
    if (took < 98 || took > 125) throw new Error(`Took ${took}ms`);
    const [, low, high] = output.match(/range (\d+) (\d+)/).map(Number);
    if (low < 22000 || low > 23500 || high < 42000 || high > 43500) throw new Error(`Range ${low} ${high}`);
    return `1600 samples took ${took}ms, unsigned around 32768`;
  },

  async 'PWM and audio compete for the same timers'() {
    const output = await runCode(`import audioio, board, pulseio, pwmio
# Variable frequency outputs take a TC, and only TC wave output 1 is usable: TC3, TC4 and TC5 here.
timers = [pwmio.PWMOut(pin, variable_frequency=True) for pin in (board.D5, board.A2, board.SCK)]
print("timers", [t.frequency for t in timers])
try:
    audioio.AudioOut(board.A0)
except RuntimeError as error:
    print("audio", error)
try:
    pulseio.PulseIn(board.D6)
except RuntimeError as error:
    print("pulsein", error)
timers[0].deinit()
speaker = audioio.AudioOut(board.A0)
print("freed", speaker.playing)
`);
    expectContains(output, 'audio All timers in use');
    expectContains(output, 'pulsein All timers in use');
    expectContains(output, 'freed False');
  },

  async 'unmodified library: ePaper display'() {
    const code = `import board, busio, digitalio, displayio, fourwire
import adafruit_il0373
displayio.release_displays()
spi = busio.SPI(board.SCK, board.MOSI)
bus = fourwire.FourWire(spi, command=board.D9, chip_select=board.D10, reset=board.D8)
report = digitalio.DigitalInOut(board.D2)
report.switch_to_output(False)
display = adafruit_il0373.IL0373(bus, width=128, height=64, rotation=0, highlight_color=0xff0000)
palette = displayio.Palette(2)
palette[0] = 0xffffff
palette[1] = 0x000000
root = displayio.Group()
root.append(displayio.TileGrid(displayio.Bitmap(128, 64, 2), pixel_shader=palette))
display.root_group = root
print("time", display.time_to_refresh)
display.refresh()
print("busy", display.busy)
report.value = True
print("drawn")
try:
    display.refresh()
except RuntimeError as error:
    print("again", error)
`;
    const board = new Board({
      files: { '/code.py': code, ...libFiles('mpy', ['adafruit_il0373.mpy']) },
      partsModule: PARTS,
      partsConfig: { spiDisplay: { dc: PINS.D9, width: 128, height: 64, reportPin: PINS.D2 } },
    });
    const frame = new Promise((resolve) => board.on('display', resolve));
    await board.waitForOutput('Code done running', 20000);
    const { commands } = await frame;
    await board.stop();
    expectContains(board.output, 'drawn');
    expectContains(board.output, 'again Refresh too soon');
    // Starts data transmission for each colour plane, then refreshes.
    for (const command of [0x10, 0x13, 0x12]) {
      if (!commands.includes(command)) throw new Error(`No ${command.toString(16)} in ${commands}`);
    }
    return `${commands.length} controller commands`;
  },

  async 'usb_cdc data port and boot.py configuration'() {
    const boot = `import usb_cdc, usb_hid, usb_midi
usb_cdc.enable(console=True, data=True)
usb_hid.disable()
usb_midi.disable()
`;
    const code = `import time, usb_cdc, usb_hid, usb_midi
print("devices", usb_hid.devices, "ports", usb_midi.ports)
data = usb_cdc.data
data.timeout = 0.2
print("console", usb_cdc.console is not None, "connected", data.connected)
data.write(b"to the computer")
print("wait")
time.sleep(0.1)
print("waiting", data.in_waiting)
print("read", data.read(5), data.read(10))
print("line", data.readline())
data.reset_input_buffer()
print("done", data.in_waiting)
for call in (lambda: usb_cdc.enable(console=False), usb_hid.disable, usb_midi.enable):
    try:
        call()
    except RuntimeError as error:
        print("late", error)
`;
    const board = new Board({ files: { '/boot.py': boot, '/code.py': code } });
    const sent = [];
    board.on('cdc', ({ data }) => sent.push(Buffer.from(data).toString()));
    await board.waitForOutput('wait');
    board.sendCdc(Buffer.from('hello'));
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'devices () ports ()');
    expectContains(board.output, 'console True connected True');
    expectContains(board.output, 'waiting 5');
    expectContains(board.output, "read b'hello' b''");
    expectContains(board.output, 'done 0');
    if (board.output.match(/late Cannot change USB devices now/g)?.length !== 3) throw new Error(board.output);
    if (sent.join('') !== 'to the computer') throw new Error(sent.join());
  },

  async 'usb_cdc follows the real defaults'() {
    const output = await runCode(`import supervisor, usb_cdc, usb_hid, usb_midi
print("usb", supervisor.runtime.usb_connected, supervisor.runtime.serial_connected)
print("console", usb_cdc.console is not None, "data", usb_cdc.data)
print("hid", [(hex(d.usage_page), hex(d.usage)) for d in usb_hid.devices])
print("midi", len(usb_midi.ports))
usb_cdc.console.write(b"console text\\r\\n")
`);
    expectContains(output, 'usb True True');
    expectContains(output, 'console True data None');
    expectContains(output, "hid [('0x1', '0x6'), ('0x1', '0x2'), ('0xc', '0x1')]");
    expectContains(output, 'midi 2');
    expectContains(output, 'console text');
  },

  async 'unmodified library: adafruit_hid keyboard'() {
    const code = `import usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode
keyboard = Keyboard(usb_hid.devices)
keyboard.press(Keycode.SHIFT, Keycode.A)
keyboard.release_all()
print("typed")
`;
    const board = new Board({ files: { '/code.py': code, ...libFiles('mpy', ['adafruit_hid']) } });
    const reports = [];
    board.on('hid', ({ reportId, report }) => reports.push([reportId, ...report]));
    await board.waitForOutput('Code done running', 15000);
    await sleep(50);
    await board.stop();
    expectContains(board.output, 'typed');
    const pressed = reports.find((report) => report[3] === 4);
    if (!pressed || pressed[0] !== 1 || pressed[1] !== 2) throw new Error(JSON.stringify(reports));
    if (reports.at(-1).slice(1).some(Boolean)) throw new Error(`Keys stuck: ${JSON.stringify(reports)}`);
    return `${reports.length} HID reports, report ID 1`;
  },

  async 'unmodified library: adafruit_midi both ways'() {
    const code = `import time, usb_midi
import adafruit_midi
from adafruit_midi.note_on import NoteOn
midi = adafruit_midi.MIDI(midi_in=usb_midi.ports[0], midi_out=usb_midi.ports[1], out_channel=0, in_channel=0)
midi.send(NoteOn(60, 100))
print("wait")
time.sleep(0.1)
message = midi.receive()
print("received", type(message) is NoteOn, message.note, message.velocity)
`;
    const board = new Board({ files: { '/code.py': code, ...libFiles('mpy', ['adafruit_midi']) } });
    const sent = [];
    board.on('midi', ({ data }) => sent.push(...data));
    await board.waitForOutput('wait', 15000);
    board.sendMidi([0x90, 64, 90]);
    await board.waitForOutput('Code done running');
    await board.stop();
    expectContains(board.output, 'received True 64 90');
    if (sent.join() !== '144,60,100') throw new Error(sent.join());
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
