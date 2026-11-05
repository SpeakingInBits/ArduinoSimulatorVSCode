#pragma once

#include <stdint.h>

// Copied from ports/atmel-samd/mpconfigport.h (SAMD21 section) so that language features
// match the real board. Students should not get features here that the M0 lacks.
#define CIRCUITPY_MCU_FAMILY                        samd21
#define MICROPY_PY_SYS_PLATFORM                     "Atmel SAMD21"
#define MICROPY_PY_BUILTINS_COMPLEX                 (0)
#define MICROPY_PY_BUILTINS_NOTIMPLEMENTED          (0)
#define MICROPY_PY_FUNCTION_ATTRS                   (0)
#define MICROPY_PY_REVERSE_SPECIAL_METHODS          (0)
#define MICROPY_PY_COLLECTIONS_DEQUE                (0)
#define MICROPY_PY_COLLECTIONS_ORDEREDDICT          (0)
#define MICROPY_FATFS_EXFAT                         (0)
#define MICROPY_FATFS_MKFS_FAT32                    (0)
#define MICROPY_QSTR_BYTES_IN_HASH                  (0)
#define CIRCUITPY_PYSTACK_SIZE                      1536

// The wasm shadow stack is used differently from the ARM stack, so this is not the M0's
// 3584 bytes. Recursion limits are therefore approximate.
#define CIRCUITPY_DEFAULT_STACK_SIZE                (128 * 1024)

// Upper limit for the port heap. The board profile picks the size used at runtime, standing
// in for the SRAM left after .data, .bss and the stack on the real chip.
#define SIM_MAX_PORT_HEAP_BYTES                     (256 * 1024)
#define SIM_FLASH_BYTES                             (2 * 1024 * 1024)

// Emscripten provides printf, and its C library clashes with the internal one.
#define MICROPY_USE_INTERNAL_PRINTF                 (0)

#include "py/circuitpy_mpconfig.h"

// Every run starts from a fresh filesystem, so the real board's one-time 1 second wait
// before writing boot_out.txt would otherwise delay every Run.
#undef CIRCUITPY_BOOT_OUTPUT_FILE
