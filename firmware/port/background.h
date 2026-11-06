#pragma once

#include <stdint.h>

// Polls the simulator for elapsed ticks and a pending keyboard interrupt.
void sim_service(void);

// Blocks like the real drivers' "while not done, run background tasks" loops, but lets Stop through.
void sim_wait_us(uint64_t us);
