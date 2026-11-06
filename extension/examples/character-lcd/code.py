# Counts up on a 16x2 character LCD.
import time

import adafruit_character_lcd.character_lcd as character_lcd
import board
import digitalio

pins = [digitalio.DigitalInOut(pin) for pin in (board.D7, board.D8, board.D9, board.D10, board.D11, board.D12)]
lcd = character_lcd.Character_LCD_Mono(*pins, 16, 2)

count = 0
while True:
    lcd.message = "Hello, Metro!\nCount: " + str(count)
    count += 1
    time.sleep(1)
