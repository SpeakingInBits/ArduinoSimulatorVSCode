"""Copies selected libraries out of the Adafruit bundle zips, without executing anything."""
import pathlib
import sys
import zipfile

bundle_dir, out_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
WANTED = ("adafruit_character_lcd/", "adafruit_motor/", "adafruit_bus_device/", "adafruit_mcp9808",
          "neopixel", "adafruit_pixelbuf", "adafruit_register/", "adafruit_debouncer", "adafruit_ticks", "simpleio")
for archive in bundle_dir.glob("*.zip"):
    kind = "mpy" if "-mpy-" in archive.name else "py"
    with zipfile.ZipFile(archive) as z:
        count = 0
        for name in z.namelist():
            inner = name.split("/lib/", 1)
            if len(inner) == 2 and inner[1].startswith(WANTED) and not name.endswith("/"):
                target = out_dir / kind / inner[1]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(name))
                count += 1
    print(archive.name, count, "files")
