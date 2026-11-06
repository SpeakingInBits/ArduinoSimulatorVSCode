# Arduino Simulator for VS Code

A VS Code extension that lets students build circuits and test CircuitPython for the Adafruit
Metro M0 Express without a physical board. Arduino C++ support for the Metro 328 is planned.

| Folder | What it holds |
|---|---|
| [`extension/`](extension/README.md) | The VS Code extension: circuit builder, electrical simulator and part models |
| [`firmware/`](firmware/README.md) | Real CircuitPython compiled to WebAssembly, with its test harness |

## Build it

These steps are for Windows with Git Bash, Python 3.12 or later, and GNU make. Keep the repo in a
short path, because Emscripten's install fails in a deeply nested folder.

```bash
sh firmware/setup.sh
```

```bash
sh firmware/build.sh -j8
```

```bash
NODE="$PWD/$(ls -d firmware/.toolchain/emsdk/node/*_64bit)/node.exe"; cd extension && "$NODE" scripts/copy-assets.js && "$NODE" scripts/make-examples.js && "$NODE" --test test/*.test.js
```

Then open the `extension` folder in VS Code and press F5, or run it directly:

```bash
code --extensionDevelopmentPath="$PWD/extension"
```
