// Gathers build outputs that are not kept in git: the firmware, Adafruit libraries for kit
// parts, and type stubs for autocomplete. Run after `sh firmware/setup.sh` and a firmware build.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firmware = path.resolve(root, '..', 'firmware');
const build = path.join(firmware, 'circuitpython', 'ports', 'webassembly', 'build-metro_m0_express');

fs.mkdirSync(path.join(root, 'firmware'), { recursive: true });
fs.copyFileSync(path.join(build, 'firmware.js'), path.join(root, 'firmware', 'firmware.cjs'));
fs.copyFileSync(path.join(build, 'firmware.wasm'), path.join(root, 'firmware', 'firmware.wasm'));
console.log('Copied firmware');

// Libraries students commonly need with a starter kit.
const LIBRARIES = [
  'adafruit_bus_device', 'adafruit_character_lcd', 'adafruit_debouncer', 'adafruit_dht', 'adafruit_display_text',
  'adafruit_displayio_ssd1306', 'adafruit_ds18x20', 'adafruit_ds3231', 'adafruit_hcsr04', 'adafruit_irremote',
  'adafruit_matrixkeypad', 'adafruit_max7219', 'adafruit_mcp9808', 'adafruit_motor', 'adafruit_mpu6050',
  'adafruit_onewire', 'adafruit_pixelbuf', 'adafruit_register', 'adafruit_rgbled', 'adafruit_ssd1306',
  'adafruit_framebuf', 'adafruit_ticks', 'adafruit_74hc595', 'neopixel', 'simpleio',
];
const bundleDir = path.join(firmware, '.toolchain', 'bundle');
const bundle = fs.readdirSync(bundleDir).find((name) => name.includes('10.x-mpy') && name.endsWith('.zip'));
const libs = path.join(root, 'libs');
fs.rmSync(libs, { recursive: true, force: true });
fs.mkdirSync(libs, { recursive: true });
const script = `
import sys, zipfile, pathlib
archive, out, wanted = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3].split(",")
count = 0
with zipfile.ZipFile(archive) as z:
    for name in z.namelist():
        inner = name.split("/lib/", 1)
        if len(inner) != 2 or name.endswith("/"):
            continue
        top = inner[1].split("/")[0].removesuffix(".mpy")
        if top in wanted:
            target = out / inner[1]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(name))
            count += 1
print(count, "library files")
`;
console.log(execFileSync('python', ['-I', '-c', script, path.join(bundleDir, bundle), libs, LIBRARIES.join(',')]).toString().trim());

// CircuitPython's own type stubs give students autocomplete and inline documentation.
const stubs = path.join(root, 'stubs');
const download = path.join(root, '.stubs-download');
fs.rmSync(stubs, { recursive: true, force: true });
fs.rmSync(download, { recursive: true, force: true });
execFileSync('python', ['-m', 'pip', 'install', '-q', '--no-deps', '--target', download, 'circuitpython-stubs==10.3.1'], { stdio: 'ignore' });
fs.mkdirSync(stubs);
for (const entry of fs.readdirSync(download)) {
  if (entry.endsWith('-stubs')) fs.cpSync(path.join(download, entry), path.join(stubs, entry), { recursive: true });
}
fs.rmSync(download, { recursive: true, force: true });
console.log(`Copied ${fs.readdirSync(stubs).length} stub packages`);
