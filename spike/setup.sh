#!/bin/sh
# Fetches everything the spike needs that is not in this repo. Safe to run again.
# Windows with Git Bash and Python 3.12 or later. Also needs GNU make:
#   winget install --id ezwinports.make --scope user
set -e

CIRCUITPYTHON_VERSION=10.3.1
EMSCRIPTEN_VERSION=6.0.13

S="$(cd "$(dirname "$0")" && pwd)"
T="$S/.toolchain"
mkdir -p "$T"

if [ ! -d "$S/circuitpython" ]; then
  git -c core.longpaths=true clone --depth 1 --branch "$CIRCUITPYTHON_VERSION" \
    https://github.com/adafruit/circuitpython.git "$S/circuitpython"
fi
git -C "$S/circuitpython" -c core.longpaths=true submodule update --init --depth 1 lib/tlsf lib/tinyusb

if [ ! -d "$T/emsdk" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$T/emsdk"
fi
(cd "$T/emsdk" && python emsdk.py install "$EMSCRIPTEN_VERSION" && python emsdk.py activate "$EMSCRIPTEN_VERSION")

if [ ! -d "$T/venv" ]; then
  python -m venv "$T/venv"
fi
"$T/venv/Scripts/python" -m pip install -q huffman polib jinja2 cascadetoml tomlkit intelhex minify_html jsmin pyyaml

python -I "$S/tools/fetch_bundle.py" "$T/bundle"
python -I "$S/tools/extract_libs.py" "$T/bundle" "$S/tests/libs"
mkdir -p "$S/example/lib"
cp "$S/tests/libs/mpy/neopixel.mpy" "$S/tests/libs/mpy/adafruit_pixelbuf.mpy" "$S/example/lib/"

echo "Setup complete. Next: sh build.sh -j8"
