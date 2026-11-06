# Turn the potentiometer to change the LED's brightness.
import time

import analogio
import board
import pwmio

knob = analogio.AnalogIn(board.A0)
led = pwmio.PWMOut(board.D5, frequency=1000)

while True:
    led.duty_cycle = knob.value
    print("Knob voltage:", round(knob.value * 3.3 / 65535, 2))
    time.sleep(0.2)
