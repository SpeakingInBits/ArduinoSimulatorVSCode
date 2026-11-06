"""Unpacks a '#### FILE: path' bundle into a directory. Usage: unpack.py <bundle> <dest>"""
import pathlib
import sys

bundle, dest = sys.argv[1], pathlib.Path(sys.argv[2])
current, lines, count = None, [], 0


def flush():
    global count
    if current is not None:
        path = dest / current
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(lines), encoding="utf-8", newline="\n")
        count += 1


for line in open(bundle, encoding="utf-8"):
    if line.startswith("#### FILE: "):
        flush()
        current, lines = line[len("#### FILE: "):].strip(), []
    else:
        lines.append(line)
flush()
print(f"wrote {count} files")
