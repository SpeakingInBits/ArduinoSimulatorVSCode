#pragma once

#define MICROPY_HW_BOARD_NAME "Adafruit Metro M0 Express"
#define MICROPY_HW_MCU_NAME "samd21g18"

#define MICROPY_HW_NEOPIXEL (&pin_PA30)

#define DEFAULT_I2C_BUS_SCL (&pin_PA23)
#define DEFAULT_I2C_BUS_SDA (&pin_PA22)

#define DEFAULT_SPI_BUS_SCK (&pin_PB11)
#define DEFAULT_SPI_BUS_MOSI (&pin_PB10)
#define DEFAULT_SPI_BUS_MISO (&pin_PA12)

#define DEFAULT_UART_BUS_RX (&pin_PA11)
#define DEFAULT_UART_BUS_TX (&pin_PA10)
