# CircuitPython WebAssembly firmware

Real CircuitPython 10.3.1, compiled to WebAssembly and set up to behave like a Metro M0 Express.
The [extension](../extension/README.md) runs it. This folder also holds a small test host.

## Layout

| Path | What it is |
|---|---|
| `port/` | The new port. `build.sh` copies it into CircuitPython 10.3.1, which is otherwise unchanged |
| `host/` | Minimal test host that runs the engine in a worker thread, with mock parts |
| `tests/spike-checks.cjs` | The 55 automated checks |
| `tests/compare_on_real_board.py` | Run on a real board and in the simulator, then compare |
| `SIM_INTERFACE.md` | Every function a host must provide. Implement a host from this |
| `tools/`, `setup.sh`, `build.sh` | Helper scripts, dependency setup and build script |
| `circuitpython/`, `.toolchain/` | Created by `setup.sh`. Not in source control |

## Build and test

These steps are for Windows with Git Bash, Python 3.12 or later, and GNU make. Run them from the
`firmware` folder. `NODE` is the copy of Node that Emscripten installed. Keep the repo in a short
path, because Emscripten's install fails with "filename too long" in a deeply nested folder.

```bash
winget install --id ezwinports.make --scope user
```

```bash
sh setup.sh
```

```bash
sh build.sh -j8
```

```bash
NODE="$PWD/$(ls -d .toolchain/emsdk/node/*_64bit)/node.exe"; cd tests && "$NODE" spike-checks.cjs
```

## Original feasibility checks

| Check | Result |
|---|---|
| CircuitPython 10.3.1 builds to WebAssembly with a working REPL in VS Code | Pass |
| A `while True` blink loop runs without freezing, and Stop works | Pass: 100.7-101.9ms for a 100ms sleep, Stop in 1-2ms from the host and 17-44ms from the panel |
| Unmodified Adafruit libraries drive simulated parts | Pass for LCD, servo, MCP9808 and NeoPixel, using `.mpy` files |
| Error messages match a real Metro | Partly: 11 match the CircuitPython source. **Not yet compared with a real board** |

## Measurements

| Measure | Value |
|---|---|
| Modules | All 41 of the real board's modules, and no others |
| Changes to CircuitPython shared code | None. The port is new files, one overridden build rule and one per-file compiler flag |
| Port size | About 3,750 lines, plus the generated pin table |
| Engine size | 705KB `.wasm` (259KB gzipped) plus 34KB of JavaScript |
| Start to first output | 85-100ms |
| Free memory in `code.py` | About 20KB, from a 24KB estimate that still needs calibrating |
| CPU use | 2.1-2.6% when sleeping or at the REPL, measured over 6 seconds, and 100% in a busy loop |
| Python speed | 1.4-2.5 million loop iterations per second |
| Panel response in VS Code | 23-277ms depending on the action and on VS Code start-up activity |

## What the feasibility work found

- **The engine must run in the extension host.** `SharedArrayBuffer` is undefined in the webview,
  so blocking sleeps cannot work there.
- **`--spill-pointers` is required.** Without it, a live object is freed and the interpreter
  crashes, which the GC stress test shows. With it, free memory stays flat for 150 rounds.
  The link must keep names (`-g2`) because Binaryen finds `__stack_pointer` by name.
- **Build settings must follow the real board.** `CIRCUITPY_FULL_BUILD=0` silently changed the
  language, so `mpconfigport.mk` follows the SAMD21 configuration.
- **Windows make truncates long commands without an error.** It dropped most sources from string
  table generation. `qstr_pp.py` and the link rule avoid this by using files.

## Known gaps

- **No real board comparison yet.** Memory, speed, float printing and error messages all need it.
  Hardware rules come from reading the `atmel-samd` source, not from testing a board.
- **Speed is probably well above a real M0.** CPU-heavy code will look faster than on hardware.
- **Heap size needs calibrating again.** The 24KB estimate predates `displayio`, audio and USB,
  whose static data takes RAM on a real M0. The simulator's heap did not shrink to match.
- **CIRCUITPY is read-only to Python unless `boot.py` remounts it**, matching a board attached to a
  computer.
- **USB is simulated above the device stack.** There is no enumeration, and the board is always
  "connected" after `boot.py`:
  - The computer cannot send HID reports to the board, so keyboard LED state never changes.
  - `usb_cdc.data.connected` is always true.
  - Custom HID descriptors are accepted without being checked by any host.
- **Some timing is not modelled.** I2C, SPI and display transfers take no simulated time, so a
  display refreshes much faster than on hardware. UART writes, `PulseOut` and `PDMIn` do take their
  real time.
- **Some hardware details are simplified:**
  - `rtc.calibration` is stored but has no effect.
  - `touchio` readings use the host's scale, not the real chip's.
  - Audio is not reduced to the DAC's 10 bits.
  - UART parity and flow control pins are validated, but nothing happens on the wire.
  - `PulseIn`'s "Input taking too long" check adds up pulse lengths rather than reading a timer.
  - `rotaryio` only sees net movement between reads of `position`.
- **A real quirk is kept on purpose.** After a variable frequency `PWMOut` ends, the other channels
  of its timer stay claimed until power off, because the real driver never clears them.
- **Short sleeps can overshoot on Windows.** A 10ms sleep measured 12-16ms.
- **JavaScript cannot time microsecond signals.** Bit-banged parts must use `delayUs`, as
  `SIM_INTERFACE.md` explains.
- **Recursion limits and float constants are approximate.** The shadow stack differs from the ARM
  stack, and Clang ignores `-fsingle-precision-constant`.
- **Only tested on Windows.** macOS and Linux have not been run, and neither has an installed
  `.vsix`.
- **Browser use is unsolved.** vscode.dev and Chromebooks would need another way to block.
- **There is no circuit editor.** Parts are fixed in the panel or configured in test code.
