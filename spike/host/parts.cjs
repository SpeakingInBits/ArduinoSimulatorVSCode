// Simulated kit parts used by the spike tests. Each one reacts to the same pin and bus
// activity a physical part would see, and knows nothing about Python.

// Pin numbers from the Metro M0 Express board definition (PA = n, PB = 32 + n).
const PINS = {
  D0: 11, D1: 10, D2: 14, D3: 9, D4: 8, D5: 15, D6: 20, D7: 21, D8: 6, D9: 7, D10: 18,
  D11: 16, D12: 19, D13: 17, A0: 2, A1: 40, A2: 41, A3: 4, A4: 5, A5: 34, NEOPIXEL: 30,
  SDA: 22, SCL: 23,
};

// HD44780 16x2 character display driven in 4-bit mode, as wired in most kits.
class CharacterLcd {
  constructor({ rs, en, d4, d5, d6, d7 }) {
    this.pins = { rs, en, data: [d4, d5, d6, d7] };
    this.levels = new Map();
    this.highNibble = null;
    this.address = 0;
    this.ram = new Array(0x68).fill(0x20);
  }

  onPinWrite(pin, value) {
    const wasHigh = this.levels.get(pin);
    this.levels.set(pin, value);
    if (pin === this.pins.en && wasHigh && !value) this.latchNibble();
  }

  latchNibble() {
    const nibble = this.pins.data.reduce((bits, pin, i) => bits | ((this.levels.get(pin) ? 1 : 0) << i), 0);
    if (this.highNibble === null) {
      this.highNibble = nibble;
      return;
    }
    const byte = (this.highNibble << 4) | nibble;
    this.highNibble = null;
    if (this.levels.get(this.pins.rs)) {
      this.ram[this.address++] = byte;
    } else {
      this.command(byte);
    }
  }

  command(byte) {
    if (byte === 0x01) {
      this.ram.fill(0x20);
      this.address = 0;
    } else if (byte === 0x02) {
      this.address = 0;
    } else if (byte & 0x80) {
      this.address = byte & 0x7f;
    }
  }

  lines() {
    const row = (start) => String.fromCharCode(...this.ram.slice(start, start + 16));
    return [row(0x00), row(0x40)];
  }
}

// Hobby servo: the angle follows the PWM pulse width, 0.5ms to 2.5ms over 0 to 180 degrees.
class Servo {
  constructor({ pin, onAngle }) {
    this.pin = pin;
    this.onAngle = onAngle;
  }

  onPwm(pin, frequency, duty) {
    if (pin !== this.pin) return;
    const pulseMs = (duty / 65535) * (1000 / frequency);
    this.onAngle(Math.round(((pulseMs - 0.5) / 2) * 180));
  }
}

// MCP9808 I2C temperature sensor with a fixed reading.
class Mcp9808 {
  constructor({ celsius = 22.5 }) {
    this.i2cAddress = 0x18;
    this.pointer = 0;
    this.celsius = celsius;
  }

  i2cWrite(data) {
    if (data.length > 0) this.pointer = data[0];
  }

  i2cRead(buffer) {
    const raw = Math.round(this.celsius * 16);
    const registers = {
      5: [(raw >> 8) & 0x1f, raw & 0xff],
      6: [0x00, 0x54], // Manufacturer ID.
      7: [0x04, 0x00], // Device ID.
    };
    const value = registers[this.pointer] ?? [0, 0];
    for (let i = 0; i < buffer.length; i++) buffer[i] = value[i] ?? 0;
  }
}

module.exports = { PINS, CharacterLcd, Servo, Mcp9808 };
