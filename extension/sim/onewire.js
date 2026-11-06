// DS18B20 on a one-wire bus. Slot lengths come from adding up the firmware's own delays, not
// from a clock: JavaScript can stall for far longer than a 6 microsecond slot.
const RESET_MIN_US = 300;
const WRITE_ZERO_MIN_US = 30;

export function crc8(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    let value = byte;
    for (let i = 0; i < 8; i++) {
      const mix = (crc ^ value) & 1;
      crc >>= 1;
      if (mix) crc ^= 0x8c;
      value >>= 1;
    }
  }
  return crc;
}

const toBits = (bytes) => bytes.flatMap((byte) => [0, 1, 2, 3, 4, 5, 6, 7].map((bit) => (byte >> bit) & 1));

export class Ds18b20 {
  constructor(readCelsius) {
    this.readCelsius = readCelsius;
    const rom = [0x28, 0x5a, 0x10, 0x2c, 0x05, 0x00, 0x00];
    this.rom = [...rom, crc8(rom)];
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

  pulled(boardMicros) {
    this.lowSince = boardMicros;
  }

  released(boardMicros) {
    if (this.lowSince === null) return;
    const lowUs = boardMicros - this.lowSince;
    this.lowSince = null;
    this.slot(lowUs);
  }

  // The level this device holds the bus at for the next read, or null if it is letting go.
  takeReply() {
    const { reply } = this;
    this.reply = null;
    return reply;
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
      const raw = Math.round(this.readCelsius() * 16);
      const scratchpad = [raw & 0xff, (raw >> 8) & 0xff, 0x4b, 0x46, 0x7f, 0xff, 0x0c, 0x10];
      this.sending = toBits([...scratchpad, crc8(scratchpad)]);
    } else if (command === 0xb4) {
      this.sending = [1]; // Not powered from the data line.
    }
    // Other commands, such as starting a conversion, need no reply here.
  }
}
