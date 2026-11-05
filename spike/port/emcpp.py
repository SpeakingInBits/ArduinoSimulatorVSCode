"""Preprocessor wrapper for the CircuitPython build.

py/makeqstrdefs.py passes a batch of source files to one preprocessor call, but `emcc -E`
only handles the first. This runs one call per source file and joins the output. The build
also pipes text through the preprocessor with "-", which needs an explicit language.
"""
import subprocess
import sys

SOURCE_SUFFIXES = (".c", ".cc", ".cpp")

args = sys.argv[1:]
flags = [arg for arg in args if not arg.endswith(SOURCE_SUFFIXES)]
sources = [arg for arg in args if arg.endswith(SOURCE_SUFFIXES)]

if "-" in flags:
    flags.remove("-")
    sys.exit(subprocess.run(["emcc", "-x", "c", *flags, "-"]).returncode)

for source in sources:
    result = subprocess.run(["emcc", *flags, source], stdout=subprocess.PIPE)
    if result.returncode != 0:
        sys.exit(result.returncode)
    sys.stdout.buffer.write(result.stdout)
