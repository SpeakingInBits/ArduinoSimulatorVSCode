# Hold the button to light the LED.
import time

import board
import digitalio

led = digitalio.DigitalInOut(board.D5)
led.direction = digitalio.Direction.OUTPUT

button = digitalio.DigitalInOut(board.D2)
button.switch_to_input(pull=digitalio.Pull.UP)

while True:
    led.value = not button.value
    time.sleep(0.01)
