#!/bin/sh
# Builds the WebAssembly port. Run setup.sh first. Usage: firmware/build.sh [make arguments]
S="$(cd "$(dirname "$0")" && pwd)"
E="$S/.toolchain/emsdk"
MAKE_DIR="$LOCALAPPDATA/Microsoft/WinGet/Packages/ezwinports.make_Microsoft.Winget.Source_8wekyb3d8bbwe/bin"
export EM_CONFIG="$E/.emscripten"
export PATH="$S/.toolchain/venv/Scripts:$E/upstream/emscripten:$E/upstream/bin:$(ls -d "$E"/node/*):$MAKE_DIR:$PATH"

# The port's source lives in firmware/port. CircuitPython's build needs it in its ports folder.
mkdir -p "$S/circuitpython/ports/webassembly"
cp -ru "$S/port/." "$S/circuitpython/ports/webassembly/"

cd "$S/circuitpython/ports/webassembly" || exit 1
exec make PYTHON=python BOARD=metro_m0_express "$@"
