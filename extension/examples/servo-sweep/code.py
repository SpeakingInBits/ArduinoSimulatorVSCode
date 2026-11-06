# Sweeps a servo back and forth.
import time

import board
import pwmio
from adafruit_motor import servo

pwm = pwmio.PWMOut(board.D9, duty_cycle=0, frequency=50)
motor = servo.Servo(pwm)

while True:
    for angle in range(0, 180, 5):
        motor.angle = angle
        time.sleep(0.03)
    for angle in range(180, 0, -5):
        motor.angle = angle
        time.sleep(0.03)
