#include "py/runtime.h"
#include "shared/timeutils/timeutils.h"
#include "shared-bindings/rtc/RTC.h"

#include "sim.h"

static int rtc_calibration;

void common_hal_rtc_get_time(timeutils_struct_time_t *tm) {
    timeutils_seconds_since_1970_to_struct_time((timeutils_timestamp_t)sim_rtc_get(), tm);
}

void common_hal_rtc_set_time(timeutils_struct_time_t *tm) {
    sim_rtc_set((double)timeutils_seconds_since_1970(tm->tm_year, tm->tm_mon, tm->tm_mday,
        tm->tm_hour, tm->tm_min, tm->tm_sec));
}

int common_hal_rtc_get_calibration(void) {
    return rtc_calibration;
}

// Accepted and read back like the real FREQCORR register. The simulated clock does not drift, so
// the value has nothing to correct.
void common_hal_rtc_set_calibration(int calibration) {
    mp_arg_validate_int_range(calibration, -127, 127, MP_QSTR_calibration);
    rtc_calibration = calibration;
}
