"""Downloads the latest Adafruit CircuitPython library bundles. Usage: fetch_bundle.py <dir>"""
import json
import pathlib
import sys
import urllib.request

RELEASES = "https://api.github.com/repos/adafruit/Adafruit_CircuitPython_Bundle/releases/latest"

out_dir = pathlib.Path(sys.argv[1])
out_dir.mkdir(parents=True, exist_ok=True)
with urllib.request.urlopen(RELEASES) as response:
    release = json.load(response)
for asset in release["assets"]:
    name = asset["name"]
    if name.endswith(".zip") and ("10.x-mpy" in name or "-py-" in name):
        target = out_dir / name
        if not target.exists():
            print("downloading", name)
            urllib.request.urlretrieve(asset["browser_download_url"], target)
