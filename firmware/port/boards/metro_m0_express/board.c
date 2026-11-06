#include <stdlib.h>
#include <string.h>

#include "extmod/vfs_fat.h"
#include "lib/oofatfs/ff.h"
#include "sim.h"
#include "supervisor/board.h"
#include "supervisor/filesystem.h"

// Creates each parent folder of path, ignoring folders that already exist.
static void make_parents(FATFS *fs, char *path) {
    for (char *slash = strchr(path + 1, '/'); slash != NULL; slash = strchr(slash + 1, '/')) {
        *slash = '\0';
        f_mkdir(fs, path);
        *slash = '/';
    }
}

// Runs after CIRCUITPY is mounted and before boot.py, like copying files to the USB drive.
void board_init(void) {
    FATFS *fs = &filesystem_circuitpy()->fatfs;
    char path[256];
    for (int i = 0; i < sim_fs_count(); i++) {
        if (sim_fs_name(i, path, sizeof(path)) < 0) {
            continue;
        }
        make_parents(fs, path);
        int size = sim_fs_size(i);
        uint8_t *data = malloc(size > 0 ? size : 1);
        sim_fs_read(i, data);
        FIL file;
        if (f_open(fs, &file, path, FA_WRITE | FA_CREATE_ALWAYS) == FR_OK) {
            UINT written;
            f_write(&file, data, size, &written);
            f_close(&file);
        }
        free(data);
    }
}
