# CircuitPython WebAssembly port: runs the real VM, supervisor and shared-bindings
# with the hardware layer connected to a JavaScript simulator.
BOARD ?= metro_m0_express

include ../../py/circuitpy_mkenv.mk

CC = emcc
LD = emcc
AR = emar
SIZE = true
CPP = $(PYTHON) emcpp.py -E

INC += -I. -I../.. -I$(BUILD) -I$(BUILD)/genhdr -I./boards/$(BOARD) -I../../lib/mp-readline
INC += -I$(TOP)/$(BOARD_PATH)

SRC_C += \
	background.c \
	mphalport.c \
	peripherals/pins.c \
	boards/$(BOARD)/board.c \
	boards/$(BOARD)/pins.c

COPT ?= -O2
CFLAGS += $(INC) -std=gnu11 $(BASE_CFLAGS) $(COPT) -Wno-unused-command-line-argument \
	-Wno-unknown-warning-option -Wno-unused-but-set-variable -Wno-gnu-folding-constant \
	-Wno-deprecated-non-prototype -Wno-unused-function -Wno-sign-compare \
	-Wno-tautological-constant-out-of-range-compare -Wno-implicit-const-int-float-conversion
SJLJ ?= emscripten
CFLAGS += -sSUPPORT_LONGJMP=$(SJLJ)

# GC correctness: wasm locals are invisible to a conservative stack scan, so spill them
# to the linear-memory stack where gc_helper_collect_regs_and_stack() can see them.
LDFLAGS += $(COPT) -sSUPPORT_LONGJMP=$(SJLJ) $(if $(NO_SPILL),,-sBINARYEN_EXTRA_PASSES=--spill-pointers) \
	-g2 \
	-sMODULARIZE=1 -sEXPORT_NAME=createCircuitPython -sENVIRONMENT=node,worker,web \
	-sINITIAL_MEMORY=16MB -sSTACK_SIZE=256KB -sALLOW_MEMORY_GROWTH=0 -sEXIT_RUNTIME=0 \
	-sEXPORTED_RUNTIME_METHODS=HEAPU8 -sEXPORTED_FUNCTIONS=_main -sINVOKE_RUN=1 \
	--js-library library.js

OBJ += $(PY_O) $(SUPERVISOR_O) $(addprefix $(BUILD)/, $(SRC_C:.c=.o))
OBJ += $(addprefix $(BUILD)/, $(SRC_COMMON_HAL_SHARED_MODULE_EXPANDED:.c=.o))
ifeq ($(INTERNAL_LIBM),1)
OBJ += $(addprefix $(BUILD)/, $(SRC_LIBM:.c=.o))
endif
OBJ += $(addprefix $(BUILD)/, $(SRC_CIRCUITPY_COMMON:.c=.o))
OBJ += $(addprefix $(BUILD)/, $(SRC_MOD:.c=.o))

SRC_QSTR += $(SRC_C) $(SRC_SUPERVISOR) $(SRC_CIRCUITPY_COMMON) \
	$(SRC_COMMON_HAL_SHARED_MODULE_EXPANDED) $(SRC_MOD)
SRC_QSTR_PREPROCESSOR +=

# lib/libm is the same float library the real board uses, so math results match. It uses
# newlib type names that Emscripten's libc does not define.
$(BUILD)/lib/libm/%.o: CFLAGS += -include stdint.h -D__int32_t=int32_t -D__uint32_t=uint32_t -D__uint8_t=uint8_t

all: $(BUILD)/firmware.js

$(BUILD)/firmware.js: $(OBJ) library.js
	$(STEPECHO) "LINK $@"
	$(file > $(BUILD)/firmware.objs,$(OBJ))
	$(Q)$(LD) -o $@ $(LDFLAGS) @$(BUILD)/firmware.objs

include $(TOP)/py/mkrules.mk

# Replaces the recipe in py/mkrules.mk to avoid a command too long for Windows make.
$(HEADER_BUILD)/qstr.i.last: $(SRC_QSTR) $(QSTR_GLOBAL_DEPENDENCIES) | $(QSTR_GLOBAL_REQUIREMENTS)
	$(STEPECHO) "GEN $@"
	$(file > $(BUILD)/qstr.args,pp $(CPP) output $(HEADER_BUILD)/qstr.i.last cflags $(QSTR_GEN_CFLAGS) cxxflags $(QSTR_GEN_CXXFLAGS) sources $^ dependencies $(QSTR_GLOBAL_DEPENDENCIES) changed_sources $?)
	$(Q)$(PYTHON) qstr_pp.py $(BUILD)/qstr.args $(PY_SRC)/makeqstrdefs.py
