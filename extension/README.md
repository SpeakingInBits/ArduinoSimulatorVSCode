# Metro M0 Simulator

Build circuits and test CircuitPython in VS Code, without a physical board. The simulator runs
real CircuitPython 10.3.1 compiled to WebAssembly, set up to behave like an Adafruit Metro M0
Express, so your `code.py` can move to a real board unchanged.

## Get started

1. Run **Metro Simulator: New Project from Example** from the Command Palette.
2. Open `code.py`, then run **Metro Simulator: Run on Simulator**.
3. Use **Metro Simulator: Set Up CircuitPython Autocomplete** for suggestions as you type. This
   needs the Python extension.

Each project is a folder holding `code.py`, your circuit in `circuit.json`, and a `lib` folder.
Opening `circuit.json` shows its [circuit diagram](#circuit-diagram).

## Build a circuit

| To do this | Do this |
|---|---|
| Add a part | Click it in the list on the left |
| Move a part | Drag it. Pins that land in a breadboard hole connect automatically |
| Draw a wire | Click a pin, click empty space to add bends, then click another pin |
| Rotate | Select the part and press R |
| Delete | Select it and press Delete |
| Undo or redo | Ctrl+Z or Ctrl+Y |
| Pan or zoom | Drag the background, or use the mouse wheel |

Hover over a pin to see its name and everything connected to it.

## Run it

Press **Run**. While it runs, press parts on the canvas, or use the controls on the right. The
**Serial console** shows `print()` output: click it and press Ctrl+C to stop your program and reach
the REPL.

**Problems** warns about mistakes that would matter on a real board, such as a missing resistor,
5V on a 3.3V pin, or an input left floating.

## Parts

Boards, breadboards, resistors, capacitors, diodes, LEDs, RGB LEDs, transistors, MOSFETs, buttons,
switches, potentiometers, rotary encoders, joysticks, keypads, touch pads, photoresistors,
thermistors, force sensors, TMP36, DHT11/22, DS18B20, HC-SR04, PIR, sound and water sensors, IR
receiver and remote, MPU-6050, MCP9808, DS3231, buzzers, servos, DC motors, steppers, relays,
NeoPixels, 7-segment displays, LED bars, 8x8 matrices, character LCDs, SSD1306 OLEDs, 74HC595,
L293D, and batteries.

## Differences from a real board

- Python runs much faster than on a real M0, so slow code can look fine here.
- Timing is close, not exact. Short sleeps can run a few milliseconds long on Windows.
- Memory limits are an estimate, so a program near the limit may behave differently.
- Parts are simplified. Capacitors do nothing at DC, and the display contrast pin is ignored.
- USB keyboard, mouse and MIDI output is accepted, but nothing shows it yet.

## Circuit diagram

Press **Diagram** in the builder, run **Metro Simulator: Show Circuit Diagram**, or open
`circuit.json` to see the circuit as a schematic. It shows how parts are joined rather than where
they sit, so breadboards disappear and only the board pins in use are drawn. Power and ground are
marked at each pin instead of being wired across the page.

The diagram only shows the circuit, and it updates as you build. In the builder, press **2D view** to
go back to building. In the `circuit.json` tab, press **Edit circuit** to open the builder, or **Show
JSON** to see the file as text. Hover over a wire to light up everything joined to it. Wires that
cross without a dot are not connected.

Parts need no diagram symbol: each one is drawn as a labelled block. To draw a part with its own
symbol, add it to `SYMBOLS` in `webview/diagram-art.js`.

To work on the diagram outside VS Code, serve the `extension` folder over HTTP and open
`test/diagram-preview.html?example=dimmer`.

## 3D view

The 3D view button shows the circuit in 3D. It only shows the circuit, so students still build in the 2D canvas. Close it to free its memory.

Parts need no 3D model: each one gets a body from the largest shape in its 2D art, with that art on top. To model a part by hand, add it to `BUILDERS` in `webview/scene3d.js`.

three.js 0.186.1 is kept in `webview/vendor/three`, copied from the npm package's `build` folder with its licence. It loads the first time the view opens.
