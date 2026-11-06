# Copy this file to a real Metro M0 Express as code.py, then run the same file in the
# simulator. Comparing the two outputs shows where the simulator differs from the hardware.
# Nothing needs to be wired up, and it only reads pins or claims them briefly.
import board
import digitalio
import gc
import sys
import time

print("=== version ===")
print(sys.implementation)
print(board.board_id)

print("=== memory ===")
gc.collect()
print("mem_free", gc.mem_free())

print("=== speed ===")
start = time.monotonic()
i = 0
while i < 100000:
    i += 1
print("loop_per_second", round(100000 / (time.monotonic() - start)))

print("=== floats ===")
print(0.1 + 0.2, 1 / 3, 2 ** 0.5, 1e10, 3.14159265)

print("=== sleep ===")
for ms in (10, 50, 100):
    start = time.monotonic_ns()
    time.sleep(ms / 1000)
    print("asked", ms, "measured", (time.monotonic_ns() - start) // 100000 / 10)


def report(name, action):
    try:
        action()
        print(name, "OK")
    except Exception as error:
        print(name, type(error).__name__, error)


def pin_in_use():
    first = digitalio.DigitalInOut(board.D5)
    try:
        digitalio.DigitalInOut(board.D5)
    finally:
        first.deinit()


def analog_on_digital():
    import analogio
    analogio.AnalogIn(board.D13)


def dac_on_a1():
    import analogio
    analogio.AnalogOut(board.A1)


def pwm_on_a0():
    import pwmio
    pwmio.PWMOut(board.A0)


def missing_pin():
    print(board.D99)


def write_to_input():
    pin = digitalio.DigitalInOut(board.D2)
    try:
        pin.value = True
    finally:
        pin.deinit()


def i2c_wrong_pins():
    import busio
    busio.I2C(board.D2, board.D3)


def i2c_no_pullups():
    board.I2C()


def too_big():
    bytearray(40000)


def recursion():
    def down(n):
        return down(n + 1)
    down(0)


print("=== errors ===")
report("pin_in_use", pin_in_use)
report("analog_on_digital", analog_on_digital)
report("dac_on_a1", dac_on_a1)
report("pwm_on_a0", pwm_on_a0)
report("missing_pin", missing_pin)
report("write_to_input", write_to_input)
report("i2c_wrong_pins", i2c_wrong_pins)
report("i2c_no_pullups", i2c_no_pullups)
report("too_big", too_big)
report("recursion", recursion)
print("=== done ===")
