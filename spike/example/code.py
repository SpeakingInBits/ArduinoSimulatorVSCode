# Try it: press the button in the panel, drag the potentiometer, and watch the NeoPixel.
import time

import analogio
import board
import digitalio
import neopixel

led = digitalio.DigitalInOut(board.D13)
led.direction = digitalio.Direction.OUTPUT

button = digitalio.DigitalInOut(board.D2)
button.switch_to_input(pull=digitalio.Pull.UP)

pot = analogio.AnalogIn(board.A0)
pixel = neopixel.NeoPixel(board.NEOPIXEL, 1, brightness=0.5, auto_write=True)

print("Example running")
last_level = -1
while True:
    led.value = not button.value
    level = pot.value // 257
    if level != last_level:
        print("Potentiometer:", level)
        pixel[0] = (level, 0, 255 - level)
        last_level = level
    time.sleep(0.02)
