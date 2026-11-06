// usb_cdc, usb_hid and usb_midi without USB. Their shared code talks to TinyUSB's device stack
// through the functions below, so these send the data to the simulator instead. Nothing here
// enumerates or builds descriptors: the board behaves as if a computer is always attached and
// has accepted whatever boot.py configured.
#include <string.h>

#include "shared-module/usb_cdc/__init__.h"
#include "shared-module/usb_hid/__init__.h"
#include "shared-module/usb_midi/__init__.h"
#include "sim.h"
#include "supervisor/filesystem.h"
#include "supervisor/port.h"
#include "supervisor/usb.h"
#include "tusb.h"

#define CONSOLE_ITF 0

// USB configuration is locked once boot.py has finished, as it is when the real board enumerates.
static bool connected;

bool tud_connected(void) {
    return connected;
}

bool usb_connected(void) {
    return connected;
}

bool tud_suspended(void) {
    return false;
}

bool tud_remote_wakeup(void) {
    return true;
}

// Descriptors are never built, so nothing reads these. The shared code still links to it.
void usb_add_interface_string(uint8_t interface_string_index, const char str[]) {
}

// usb_cdc. Interface 0 is the console, which is the same stream as the REPL on a real board.
bool tud_cdc_n_connected(uint8_t itf) {
    return true;
}

uint32_t tud_cdc_n_available(uint8_t itf) {
    return itf == CONSOLE_ITF ? sim_serial_available() : sim_cdc_available();
}

uint32_t tud_cdc_n_read(uint8_t itf, void *buffer, uint32_t bufsize) {
    uint8_t *out = buffer;
    uint32_t count = 0;
    while (count < bufsize && tud_cdc_n_available(itf) > 0) {
        out[count++] = itf == CONSOLE_ITF ? sim_serial_read() : sim_cdc_read();
    }
    return count;
}

void tud_cdc_n_read_flush(uint8_t itf) {
    uint8_t discard;
    while (tud_cdc_n_read(itf, &discard, 1) > 0) {
    }
}

uint32_t tud_cdc_n_write(uint8_t itf, void const *buffer, uint32_t bufsize) {
    if (itf == CONSOLE_ITF) {
        sim_serial_write(buffer, bufsize);
    } else {
        sim_cdc_write(buffer, bufsize);
    }
    return bufsize;
}

// Writes go straight through, so there is never anything waiting to be sent.
uint32_t tud_cdc_n_write_flush(uint8_t itf) {
    return 0;
}

uint32_t tud_cdc_n_write_available(uint8_t itf) {
    return CFG_TUD_CDC_TX_BUFSIZE;
}

bool tud_cdc_n_write_clear(uint8_t itf) {
    return true;
}

// usb_hid.
bool tud_hid_n_ready(uint8_t instance) {
    return true;
}

uint8_t tud_hid_n_get_protocol(uint8_t instance) {
    return HID_PROTOCOL_REPORT;
}

bool tud_hid_n_report(uint8_t instance, uint8_t report_id, void const *report, uint16_t len) {
    sim_hid_send(report_id, report, len);
    return true;
}

// usb_midi.
bool tud_midi_n_mounted(uint8_t itf) {
    return true;
}

uint32_t tud_midi_n_available(uint8_t itf, uint8_t cable_num) {
    return sim_midi_available();
}

uint32_t tud_midi_n_stream_read(uint8_t itf, uint8_t cable_num, void *buffer, uint32_t bufsize) {
    uint8_t *out = buffer;
    uint32_t count = 0;
    while (count < bufsize && sim_midi_available() > 0) {
        out[count++] = sim_midi_read();
    }
    return count;
}

uint32_t tud_midi_n_stream_write(uint8_t itf, uint8_t cable_num, const uint8_t *buffer, uint32_t bufsize) {
    sim_midi_write(buffer, bufsize);
    return bufsize;
}

// main.c only makes these calls when CIRCUITPY_USB_DEVICE is on. The first VM of a boot is the one
// that runs boot.py, which gets the defaults, as usb_set_defaults() gives it. Later VMs run
// code.py or the REPL, and get what usb_setup_with_vm() gives them.
void sim_usb_vm_started(void) {
    // mp_init() runs its port hook twice. The second call is the one at the end.
    static bool at_end;
    at_end = !at_end;
    if (!at_end) {
        return;
    }
    static bool boot_vm_seen;
    if (!boot_vm_seen) {
        boot_vm_seen = true;
        // A computer is treated as attached, which makes CIRCUITPY read-only to Python on a real
        // board unless boot.py remounts it. main() cannot set this without real USB support.
        filesystem_set_internal_writable_by_usb(true);
        usb_cdc_set_defaults();
        usb_hid_set_defaults();
        usb_midi_set_defaults();
        return;
    }
    connected = true;
    usb_hid_setup_devices();
    usb_midi_setup_ports();
}

// main.c only does this when CIRCUITPY_USB_DEVICE is on.
void port_gc_collect(void) {
    usb_hid_gc_collect();
}
