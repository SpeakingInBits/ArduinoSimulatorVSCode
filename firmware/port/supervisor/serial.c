#include <stdbool.h>

#include "sim.h"
#include "supervisor/shared/serial.h"

void port_serial_early_init(void) {
}

void port_serial_init(void) {
}

bool port_serial_connected(void) {
    return true;
}

char port_serial_read(void) {
    return (char)sim_serial_read();
}

// The REPL polls this in a tight loop, so give the CPU back when nothing is arriving.
uint32_t port_serial_bytes_available(void) {
    static uint32_t idle_polls;
    uint32_t available = sim_serial_available();
    if (available > 0) {
        idle_polls = 0;
    } else if (++idle_polls > 1000) {
        idle_polls = 0;
        sim_wait_ms(1);
    }
    return available;
}

void port_serial_write_substring(const char *text, uint32_t len) {
    sim_serial_write(text, len);
}
