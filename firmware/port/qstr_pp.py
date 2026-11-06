"""Runs py/makeqstrdefs.py with its arguments read from a file.

The full argument list is over 20,000 characters, and Windows make truncates a command
that long without any error, which silently drops most source files from the scan.
"""
import pathlib
import runpy
import shlex
import sys

args_file, script = sys.argv[1:3]
sys.argv = [script] + shlex.split(pathlib.Path(args_file).read_text())
runpy.run_path(script, run_name="__main__")
