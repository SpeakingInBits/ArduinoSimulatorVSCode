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

// DS18B20 1-Wire temperature sensor. The firmware bit-bangs the bus through ordinary pin calls, so
// this part sees the master pull the line low and release it, and answers through pin reads.
// JavaScript can stall for hundreds of microseconds, so nothing here uses a clock. The length of a
// low pulse comes from the delays the board reports, and a reply goes to the next pin read.
const PIN_MODE_INPUT = 1;
const RESET_MIN_US = 300;
const WRITE_ZERO_MIN_US = 30;

function crc8(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    for (let bit = 0, value = byte; bit < 8; bit++, value >>= 1) {
      const mix = (crc ^ value) & 1;
      crc >>= 1;
      if (mix) crc ^= 0x8c;
    }
  }
  return crc;
}

const toBits = (bytes) => bytes.flatMap((byte) => [0, 1, 2, 3, 4, 5, 6, 7].map((bit) => (byte >> bit) & 1));

class Ds18b20 {
  constructor({ pin, celsius = 21.5, serial = [1, 2, 3, 4, 5, 6] }) {
    this.pin = pin;
    this.celsius = celsius;
    const rom = [0x28, ...serial];
    this.rom = [...rom, crc8(rom)];
    this.boardMicros = 0;
    this.lowSince = null;
    this.reply = null;
    this.startCommand();
  }

  startCommand() {
    this.received = [];
    this.expect = 8;
    this.sending = [];
    this.handler = (command) => this.romCommand(command);
    this.search = null;
  }

  onDelay(us) {
    this.boardMicros += us;
  }

  onPinWrite(pin, value) {
    if (pin === this.pin && !value) this.lowSince = this.boardMicros;
  }

  onPinMode(pin, mode) {
    if (pin !== this.pin || mode !== PIN_MODE_INPUT || this.lowSince === null) return;
    const lowUs = this.boardMicros - this.lowSince;
    this.lowSince = null;
    this.slot(lowUs);
  }

  onPinRead(pin) {
    if (pin !== this.pin) return undefined;
    const level = this.reply ?? 1; // The bus has a pull-up resistor.
    this.reply = null;
    return level;
  }

  slot(lowUs) {
    if (lowUs >= RESET_MIN_US) {
      this.startCommand();
      this.reply = 0; // The presence pulse.
    } else if (this.search) {
      this.searchSlot(lowUs);
    } else if (this.sending.length > 0) {
      this.reply = this.sending.shift();
    } else {
      this.received.push(lowUs < WRITE_ZERO_MIN_US ? 1 : 0);
      if (this.received.length === this.expect) {
        const bytes = [];
        for (let i = 0; i < this.received.length; i += 8) {
          bytes.push(this.received.slice(i, i + 8).reduce((value, bit, n) => value | (bit << n), 0));
        }
        this.received = [];
        this.handler(bytes.length === 1 ? bytes[0] : bytes);
      }
    }
  }

  // Each ROM bit takes three slots: send the bit, send its inverse, then read the master's choice.
  searchSlot(lowUs) {
    const bit = this.search.bits[this.search.index];
    if (this.search.phase < 2) {
      this.reply = this.search.phase === 0 ? bit : 1 - bit;
      this.search.phase++;
      return;
    }
    const chosen = lowUs < WRITE_ZERO_MIN_US ? 1 : 0;
    this.search.phase = 0;
    this.search.index++;
    if (chosen !== bit || this.search.index === this.search.bits.length) this.search = null;
  }

  romCommand(command) {
    if (command === 0xf0) {
      this.search = { bits: toBits(this.rom), index: 0, phase: 0 };
    } else if (command === 0x33) {
      this.sending = toBits(this.rom);
    } else if (command === 0x55) {
      this.expect = 64;
      this.handler = () => this.afterRom();
    } else if (command === 0xcc) {
      this.afterRom();
    }
  }

  afterRom() {
    this.expect = 8;
    this.handler = (command) => this.functionCommand(command);
  }

  functionCommand(command) {
    if (command === 0xbe) {
      const raw = Math.round(this.celsius * 16);
      const scratchpad = [raw & 0xff, (raw >> 8) & 0xff, 0x4b, 0x46, 0x7f, 0xff, 0x0c, 0x10];
      this.sending = toBits([...scratchpad, crc8(scratchpad)]);
    } else if (command === 0xb4) {
      this.sending = [1]; // Not powered from the data line.
    }
    // Other commands, such as starting a conversion, need no reply here.
  }
}

module.exports = { PINS, CharacterLcd, Servo, Mcp9808, Ds18b20 };
