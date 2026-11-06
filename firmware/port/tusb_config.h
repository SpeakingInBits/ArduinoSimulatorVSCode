// TinyUSB settings. Only TinyUSB's headers are used here, because usb_cdc, usb_hid and usb_midi
// need its types and declarations. Its device stack is not built: supervisor/usb_sim.c stands in
// for it. The buffer sizes are the SAMD21 values from ports/atmel-samd/Makefile.
#pragma once

#define CFG_TUD_ENABLED             1
#define CFG_TUSB_RHPORT0_MODE       OPT_MODE_DEVICE

#define CFG_TUD_CDC                 2
#define CFG_TUD_HID                 1
#define CFG_TUD_MIDI                1
#define CFG_TUD_MSC                 0
#define CFG_TUD_VENDOR              0

#define CFG_TUD_CDC_RX_BUFSIZE      128
#define CFG_TUD_CDC_TX_BUFSIZE      128
#define CFG_TUD_MIDI_RX_BUFSIZE     128
#define CFG_TUD_MIDI_TX_BUFSIZE     128
