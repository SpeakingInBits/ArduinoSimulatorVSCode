#pragma once

#include "py/obj.h"

typedef struct {
    mp_obj_base_t base;
    uint32_t len;
} nvm_bytearray_obj_t;
