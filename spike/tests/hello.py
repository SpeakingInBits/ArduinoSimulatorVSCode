import board
import gc
import os
import sys
import time

print("Hello from the simulated board")
print("board_id:", board.board_id)
print("platform:", sys.platform)
print("uname:", os.uname())
print("mem_free:", gc.mem_free())
print("pins:", [n for n in dir(board) if n.startswith(("A", "D"))])
print("float:", 0.1 + 0.2, 1 / 3)
start = time.monotonic()
time.sleep(0.25)
print("slept:", round(time.monotonic() - start, 2))
