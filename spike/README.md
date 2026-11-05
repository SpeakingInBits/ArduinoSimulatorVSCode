# CircuitPython WebAssembly spike

Tests whether real CircuitPython can run as a simulated Metro M0 Express inside VS Code.
This is throwaway-quality proof code, not the start of the product.

**Result: the approach works.** All four spike checks pass on Windows, with the limits below.

## Layout

| Path | What it is |
|---|---|
| `port/` | The new port. `build.sh` copies it into CircuitPython 10.3.1, which is otherwise unchanged |
| `host/` | Runs the engine in a worker thread. Includes simulated parts in `parts.cjs` |
| `vscode-extension/` | Spike extension with a board panel and a self test |
| `example/` | Small student-style project to try in the extension |
| `tests/spike-checks.cjs` | The 18 automated checks |
| `tests/compare_on_real_board.py` | Run on a real board and in the simulator, then compare |
| `tools/`, `setup.sh`, `build.sh` | Helper scripts, dependency setup and build script |
| `circuitpython/`, `.toolchain/` | Created by `setup.sh`. Not in source control |

## Try it

These steps are for Windows with Git Bash, Python 3.12 or later, and GNU make. Run them from the
`spike` folder. `NODE` is the copy of Node that Emscripten installed. Keep the repo in a short
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

```bash
code --extensionDevelopmentPath="$PWD/vscode-extension" example
```

In the window that opens, open `code.py` and run **Metro Simulator: Run Current File** from the
Command Palette.

## Spike checks

| Check | Result |
|---|---|
| CircuitPython 10.3.1 builds to WebAssembly with a working REPL in VS Code | Pass |
| A `while True` blink loop runs without freezing, and Stop works | Pass: 100.7-101.9ms for a 100ms sleep, Stop in 1-2ms from the host and 17-44ms from the panel |
| Unmodified Adafruit libraries drive simulated parts | Pass for LCD, servo, MCP9808 and NeoPixel, using `.mpy` files |
| Error messages match a real Metro | Partly: 11 match the CircuitPython source. **Not yet compared with a real board** |

## Measurements

| Measure | Value |
|---|---|
| Changes to CircuitPython shared code | None. The port is new files plus one overridden build rule |
| Port size | About 1,460 lines, plus the generated pin table |
| Engine size | 561KB `.wasm` (207KB gzipped) plus 29KB of JavaScript |
| Start to first output | 85-100ms |
| Free memory in `code.py` | About 20KB, from a 24KB estimate that still needs calibrating |
| CPU use | 0% at the REPL, 0.8% with `sleep(0.5)`, 4.7% with `sleep(0.1)`, 87.5% in a busy loop |
| Python speed | 1.4-2.5 million loop iterations per second |
| Panel response in VS Code | 23-277ms depending on the action and on VS Code start-up activity |

## What the spike found

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
- **Speed is probably well above a real M0.** CPU-heavy code will look faster than on hardware.
- **20 of the board's 41 modules are missing:**
  - Likely needed for kits: `pulseio`, `rotaryio`, `touchio`, `rtc`, `nvm`, `onewireio`, audio.
  - Display: `displayio`, `terminalio`, `fontio`, `busdisplay`, `epaperdisplay`, `fourwire`,
    `i2cdisplaybus`, `paralleldisplaybus`.
  - USB: `usb_cdc`, `usb_hid`, `usb_midi`.
- **Some hardware rules are simplified.** PWM timer sharing is not modelled, SPI and UART pins are
  not validated, SPI just echoes its data, and UART cannot receive.
- **Short sleeps can overshoot on Windows.** A 10ms sleep measured 12-16ms.
- **Recursion limits and float constants are approximate.** The shadow stack differs from the ARM
  stack, and Clang ignores `-fsingle-precision-constant`.
- **Only tested on Windows.** macOS and Linux have not been run, and neither has an installed
  `.vsix`.
- **Browser use is unsolved.** vscode.dev and Chromebooks would need another way to block.
- **There is no circuit editor.** Parts are fixed in the panel or configured in test code.
