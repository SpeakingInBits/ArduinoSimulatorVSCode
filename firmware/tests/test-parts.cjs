// Builds the parts for a test run. Runs inside the engine worker.
const { parentPort } = require('node:worker_threads');
const {
  CharacterLcd, Servo, Mcp9808, Ds18b20,
} = require('../host/parts.cjs');

const CASET = 0x2a;
const RASET = 0x2b;
const RAMWR = 0x2c;

// Records what an SPI display controller receives. dc is the data/command pin, high for data.
class SpiDisplay {
  constructor({ dc, width, height, reportPin }) {
    this.dc = dc;
    this.reportPin = reportPin;
    this.width = width;
    this.height = height;
    this.level = 0;
    this.command = null;
    this.args = [];
    this.window = { x0: 0, x1: width - 1, y0: 0, y1: height - 1 };
    this.pixels = new Uint16Array(width * height);
    this.cursor = 0;
    this.pending = null;
    this.commands = [];
  }

  onPinWrite(pin, value) {
    if (pin === this.dc) this.level = value;
    // Python asks for a report by driving this pin high.
    if (pin === this.reportPin && value) {
      parentPort.postMessage({
        type: 'display', width: this.width, pixels: this.pixels.slice(), commands: this.commands,
      });
    }
  }

  onSpi(clock, data) {
    for (const byte of data) {
      if (!this.level) {
        this.command = byte;
        this.args = [];
        this.commands.push(byte);
        this.cursor = 0;
        this.pending = null;
      } else if (this.command === RAMWR) {
        this.pixel(byte);
      } else {
        this.args.push(byte);
        if (this.args.length === 4 && this.command === CASET) {
          this.window.x0 = (this.args[0] << 8) | this.args[1];
          this.window.x1 = (this.args[2] << 8) | this.args[3];
        } else if (this.args.length === 4 && this.command === RASET) {
          this.window.y0 = (this.args[0] << 8) | this.args[1];
          this.window.y1 = (this.args[2] << 8) | this.args[3];
        }
      }
    }
    return new Uint8Array(data.length);
  }

  pixel(byte) {
    if (this.pending === null) {
      this.pending = byte;
      return;
    }
    const columns = this.window.x1 - this.window.x0 + 1;
    const x = this.window.x0 + (this.cursor % columns);
    const y = this.window.y0 + Math.floor(this.cursor / columns);
    if (x < this.width && y < this.height) this.pixels[y * this.width + x] = (this.pending << 8) | byte;
    this.cursor++;
    this.pending = null;
  }
}

// SSD1306 on I2C. The data control byte is 0x40, and commands arrive in 0x80 byte pairs.
class I2cOled {
  constructor() {
    this.i2cAddress = 0x3c;
    this.commands = 0;
    this.dataBytes = 0;
    this.lit = 0;
  }

  i2cWrite(data) {
    if (data[0] === 0x40) {
      this.dataBytes += data.length - 1;
      for (const byte of data.subarray(1)) {
        for (let bits = byte; bits; bits >>= 1) this.lit += bits & 1;
      }
    } else {
      this.commands += data.length / 2;
    }
    parentPort.postMessage({
      type: 'oled', commands: this.commands, dataBytes: this.dataBytes, lit: this.lit,
    });
  }

  i2cRead() {
  }
}

// Reports whatever arrives on a parallel display bus.
class ParallelDisplay {
  constructor() {
    this.bytes = 0;
  }

  onParallel(data0, data) {
    this.bytes += data.length;
    parentPort.postMessage({ type: 'parallel', data0, bytes: this.bytes });
  }
}

module.exports = (config = {}) => {
  const parts = [];
  if (config.lcd) {
    const lcd = new CharacterLcd(config.lcd);
    const onPinWrite = lcd.onPinWrite.bind(lcd);
    let last = '';
    lcd.onPinWrite = (pin, value) => {
      onPinWrite(pin, value);
      const lines = lcd.lines();
      if (lines.join() !== last) {
        last = lines.join();
        parentPort.postMessage({ type: 'lcd', lines });
      }
    };
    parts.push(lcd);
  }
  if (config.servo !== undefined) {
    parts.push(new Servo({
      pin: config.servo,
      onAngle: (angle) => parentPort.postMessage({ type: 'angle', angle }),
    }));
  }
  if (config.mcp9808) parts.push(new Mcp9808({}));
  if (config.ds18b20) parts.push(new Ds18b20(config.ds18b20));
  if (config.spiDisplay) parts.push(new SpiDisplay(config.spiDisplay));
  if (config.i2cOled) parts.push(new I2cOled());
  if (config.parallelDisplay) parts.push(new ParallelDisplay());
  return parts;
};
