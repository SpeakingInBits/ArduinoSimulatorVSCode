#pragma once

#include "py/obj.h"
#include "lib/oofatfs/ff.h"
#include "supervisor/shared/tick.h"

#define mp_hal_ticks_ms()       ((mp_uint_t)supervisor_ticks_ms32())

void mp_hal_set_interrupt_char(int c);
void mp_hal_disable_all_interrupts(void);
void mp_hal_enable_all_interrupts(void);
