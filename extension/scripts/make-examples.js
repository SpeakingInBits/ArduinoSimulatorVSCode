// Generates the starter projects. Each circuit is described here so that part positions and
// wires stay consistent with the catalog: run with `node scripts/make-examples.js`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultProps, emptyCircuit } from '../shared/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const GND = '#222';
const POWER = '#d33';

// Breadboard hole position. Column numbers start at 1, like the printed labels.
const BB = { x: 40, y: 290 };
const hole = (row, column) => ({
  x: BB.x + 20 + (column - 1) * 10,
  y: BB.y + (row < 'f' ? 50 + (row.charCodeAt(0) - 97) * 10 : 120 + (row.charCodeAt(0) - 102) * 10),
});

class Sketch {
  constructor() {
    this.circuit = emptyCircuit();
    this.wireCount = 0;
  }

  breadboard() {
    this.circuit.parts.unshift({ id: 'breadboard', type: 'breadboard-half', x: BB.x, y: BB.y, rotation: 0, props: {} });
    return this;
  }

  part(id, type, position, props = {}, rotation = 0) {
    this.circuit.parts.push({ id, type, ...position, rotation, props: { ...defaultProps(type), ...props } });
    return this;
  }

  wire(from, to, color = '#2e9e4f') {
    const end = (text) => {
      const [part, pin] = text.split(':');
      return { part, pin };
    };
    this.circuit.wires.push({ id: `wire${++this.wireCount}`, from: end(from), to: end(to), points: [], color });
    return this;
  }
}

const breadboardPin = (row, column) => `breadboard:${row}${column - 1}`;

const examples = {
  'blink': {
    title: 'Blink the onboard LED',
    description: 'The first program: no wiring needed.',
    sketch: new Sketch(),
    code: `# Blinks the red LED next to pin 13.
import time

import board
import digitalio

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

while True:
    led.value = True
    time.sleep(0.5)
    led.value = False
    time.sleep(0.5)
`,
  },
  'led-and-button': {
    title: 'LED and button on a breadboard',
    description: 'Wire an LED with a resistor and read a push button.',
    sketch: new Sketch().breadboard()
      .part('r1', 'resistor', hole('a', 5), { ohms: 220 })
      .part('led1', 'led', { x: hole('d', 9).x, y: hole('d', 9).y - 10 }, { color: 'green' })
      .part('button1', 'button', hole('e', 15))
      .wire('board:D5', breadboardPin('b', 5))
      .wire(breadboardPin('c', 10), 'board:GND1', GND)
      .wire('board:D2', breadboardPin('d', 15))
      .wire(breadboardPin('d', 17), 'board:GND2', GND),
    code: `# Hold the button to light the LED.
import time

import board
import digitalio

led = digitalio.DigitalInOut(board.D5)
led.direction = digitalio.Direction.OUTPUT

button = digitalio.DigitalInOut(board.D2)
button.switch_to_input(pull=digitalio.Pull.UP)

while True:
    led.value = not button.value
    time.sleep(0.01)
`,
  },
  'dimmer': {
    title: 'Potentiometer dimmer',
    description: 'Read an analog input and dim an LED with PWM.',
    sketch: new Sketch()
      .part('pot1', 'potentiometer', { x: 360, y: 260 })
      .part('r1', 'resistor', { x: 120, y: 300 }, { ohms: 220 })
      .part('led1', 'led', { x: 190, y: 290 }, { color: 'blue' })
      .wire('board:3V', 'pot1:2', POWER)
      .wire('pot1:1', 'board:GND1', GND)
      .wire('pot1:W', 'board:A0')
      .wire('board:D5', 'r1:1')
      .wire('r1:2', 'led1:A')
      .wire('led1:K', 'board:GND2', GND),
    code: `# Turn the potentiometer to change the LED's brightness.
import time

import analogio
import board
import pwmio

knob = analogio.AnalogIn(board.A0)
led = pwmio.PWMOut(board.D5, frequency=1000)

while True:
    led.duty_cycle = knob.value
    print("Knob voltage:", round(knob.value * 3.3 / 65535, 2))
    time.sleep(0.2)
`,
  },
  'servo-sweep': {
    title: 'Servo sweep',
    description: 'Drive a servo with the adafruit_motor library.',
    libraries: ['adafruit_motor'],
    sketch: new Sketch()
      .part('servo1', 'servo', { x: 380, y: 240 })
      .wire('board:5V', 'servo1:V+', POWER)
      .wire('servo1:GND', 'board:GND1', GND)
      .wire('board:D9', 'servo1:SIG', '#ff9f0a'),
    code: `# Sweeps a servo back and forth.
import time

import board
import pwmio
from adafruit_motor import servo

pwm = pwmio.PWMOut(board.D9, duty_cycle=0, frequency=50)
motor = servo.Servo(pwm)

while True:
    for angle in range(0, 180, 5):
        motor.angle = angle
        time.sleep(0.03)
    for angle in range(180, 0, -5):
        motor.angle = angle
        time.sleep(0.03)
`,
  },
  'character-lcd': {
    title: 'Character LCD',
    description: 'Show text on a 16x2 LCD in 4-bit mode.',
    libraries: ['adafruit_character_lcd'],
    sketch: new Sketch()
      .part('lcd1', 'lcd1602', { x: 110, y: 300 })
      .wire('lcd1:VSS', 'board:GND1', GND)
      .wire('lcd1:VDD', 'board:5V', POWER)
      .wire('lcd1:RW', 'board:GND2', GND)
      .wire('lcd1:LEDA', 'board:5V', POWER)
      .wire('lcd1:LEDK', 'board:GND2', GND)
      .wire('lcd1:RS', 'board:D7')
      .wire('lcd1:E', 'board:D8')
      .wire('lcd1:D4', 'board:D9')
      .wire('lcd1:D5', 'board:D10')
      .wire('lcd1:D6', 'board:D11')
      .wire('lcd1:D7', 'board:D12'),
    code: `# Counts up on a 16x2 character LCD.
import time

import adafruit_character_lcd.character_lcd as character_lcd
import board
import digitalio

pins = [digitalio.DigitalInOut(pin) for pin in (board.D7, board.D8, board.D9, board.D10, board.D11, board.D12)]
lcd = character_lcd.Character_LCD_Mono(*pins, 16, 2)

count = 0
while True:
    lcd.message = "Hello, Metro!\\nCount: " + str(count)
    count += 1
    time.sleep(1)
`,
  },
};

for (const [name, example] of Object.entries(examples)) {
  const folder = path.join(root, name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'code.py'), example.code);
  fs.writeFileSync(path.join(folder, 'circuit.json'), `${JSON.stringify(example.sketch.circuit, null, 2)}\n`);
  fs.writeFileSync(path.join(folder, 'example.json'), `${JSON.stringify({
    title: example.title, description: example.description, libraries: example.libraries ?? [],
  }, null, 2)}\n`);
}
console.log(`Wrote ${Object.keys(examples).length} examples`);
