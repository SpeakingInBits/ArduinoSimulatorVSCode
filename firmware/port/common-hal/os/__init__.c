#include <unistd.h>

#include "shared-bindings/os/__init__.h"

bool common_hal_os_urandom(uint8_t *buffer, mp_uint_t length) {
    while (length > 0) {
        mp_uint_t chunk = length > 256 ? 256 : length;
        if (getentropy(buffer, chunk) != 0) {
            return false;
        }
        buffer += chunk;
        length -= chunk;
    }
    return true;
}
