# Simulator interface

Everything the firmware needs from its host is in one object, `Module.sim`. Pass it when creating
the engine:

```js
createCircuitPython({ sim, print, printErr });
```

`host/engine-worker.cjs` is a working example of every function here. `port/sim.h` and
`port/library.js` are the C side of this interface.

## Rules for every function

- **Calls are synchronous.** Each one runs on the engine's thread and Python waits for it to return.
  Keep them short, and never call into the engine from one.
- **Every function is required unless marked optional.** A missing one throws and stops the engine,
  but only when it is first called. Most are only called when Python uses that feature.
- **`rtcGet` is needed at startup.** The filesystem calls it to timestamp the student's files.
- **Arrays are copies, so you can keep them.** The one exception is `i2cRead`, which passes a live
  view of engine memory. It is only valid during the call.
- **Times are in microseconds unless the name says otherwise.**

### Pin numbers

Pins use the chip's port numbering: PA*n* is *n*, and PB*n* is 32 + *n*.

| Board name | Pin | Board name | Pin | Board name | Pin |
|---|---|---|---|---|---|
| D0 / RX | 11 | D7 | 21 | A0 | 2 |
| D1 / TX | 10 | D8 | 6 | A1 | 40 |
| D2 | 14 | D9 | 7 | A2 | 41 |
| D3 | 9 | D10 | 18 | A3 | 4 |
| D4 | 8 | D11 | 16 | A4 | 5 |
| D5 | 15 | D12 | 19 | A5 | 34 |
| D6 | 20 | D13 / LED | 17 | NEOPIXEL | 30 |
| SDA | 22 | SCK | 43 | MOSI | 42 |
| SCL | 23 | MISO | 12 | | |

## Properties

| Name | Type | Meaning |
|---|---|---|
| `files` | `{ path: string, data: Uint8Array }[]` | Copied onto CIRCUITPY at startup. Paths start with `/` |
| `portHeapBytes` | number | Python heap size. 24576 is the current estimate for a Metro M0 |

## Serial console

| Function | Returns | Notes |
|---|---|---|
| `serialWrite(data: Uint8Array)` | nothing | Console output |
| `serialAvailable()` | number | Bytes waiting to be read |
| `serialPeek()` | byte, or -1 | Does not consume the byte. Polled often, to catch Ctrl-C (3) |
| `serialRead()` | byte, or -1 | Consumes one byte |

The same stream serves `usb_cdc.console`.

## Time and control

| Function | Returns | Notes |
|---|---|---|
| `waitMs(ms: number)` | nothing | Blocks the thread for up to `ms`, usually 1 to 20. Must return early when input arrives, or Stop gets slow |
| `reset(toBootloader: 0 or 1)` | never returns | Park the thread and restart the engine |
| `delayUs(us)` | nothing | **Optional.** See below |

### `delayUs`: exact timing for bit-banged parts

The firmware calls this just before it spins for `us` microseconds in `onewireio`,
`microcontroller.delay_us` and the `PulseIn` trigger pulse. It is optional, and hosts without
bit-banged parts can leave it out.

**Do not time bit-banged signals with a clock.** JavaScript stalls unpredictably. A OneWire 1-bit
is 6us long, and measured with `performance.now()`, about 2% of them looked longer than 30us, with
some reaching 842us. A DS18B20 read uses about 250 write slots, so it would usually fail.

Instead, add up the delays to get board time, as `Ds18b20` in `host/parts.cjs` does:

- Take the length of a low pulse from the delays between `pinWrite(pin, 0)` and the
  `pinMode(pin, 1, ...)` that releases the line. This gives exactly 6 or 60.
- Answer on the next `pinRead`, whenever it comes, not during a time window.

## Pins

| Function | Returns | Notes |
|---|---|---|
| `pinMode(pin, mode, pull, openDrain)` | nothing | See the values below. Also called with mode 0 when a pin is released |
| `pinWrite(pin, value)` | nothing | `value` is 0 or 1 |
| `pinRead(pin)` | 0 or 1 | Must honour the pull set by `pinMode` when nothing drives the pin |
| `adcRead(pin)` | 0 to 4095 | Raw 12-bit reading. The firmware scales it for Python |
| `dacWrite(pin, value)` | nothing | Raw 10-bit value, 0 to 1023. A0 only |
| `pwmSet(pin, frequency, duty)` | nothing | `frequency` is what the real timer would produce, after rounding. `duty` is 0 to 65535 |
| `neopixelWrite(pin, data: Uint8Array)` | nothing | Bytes in the order the library sent them, usually GRB |

| `mode` | Meaning | | `pull` | Meaning |
|---|---|---|---|---|
| 0 | Off | | 0 | None |
| 1 | Digital input | | 1 | Up |
| 2 | Digital output | | 2 | Down |
| 3 | Analog input, also used for touch | | | |
| 4 | Analog output | | | |
| 5 | PWM | | | |

`openDrain` is 0 or 1. An encoder's pins arrive as mode 1 with pull 1, as on the real board.

## Buses

The firmware checks all pin rules before calling these, so the host never sees an invalid bus.

| Function | Returns | Notes |
|---|---|---|
| `i2cPullups(scl, sda)` | truthy if pulled up | Falsy gives the real "No pull up found" error |
| `i2cProbe(address)` | truthy if present | |
| `i2cWrite(address, data: Uint8Array)` | 0, or a positive errno | 19 (ENODEV) for a missing device |
| `i2cRead(address, buffer: Uint8Array)` | 0, or a positive errno | Fill `buffer` in place. Only valid during the call |
| `spiTransfer(clock, data: Uint8Array, mosi)` | `Uint8Array` | `clock` is the SCK pin, which identifies the bus. `mosi` is the data out pin, or -1 if the bus has none. Return at least `data.length` bytes. For a read, `data` is filled with the byte Python asked to send |
| `parallelWrite(data0, data: Uint8Array)` | nothing | **New.** One byte per write strobe. `data0` is the pin number of data line 0. Data/command and chip select arrive as ordinary `pinWrite` calls on their pins |
| `uartWrite(tx, data: Uint8Array)` | nothing | Return at once. The firmware waits for the bytes' time on the wire |
| `uartAvailable(rx)` | number | Bytes received and not yet read |
| `uartRead(rx)` | byte, or -1 | |

UART data can be queued as fast as you like. The firmware moves it into a ring of
`receiver_buffer_size` bytes (64 by default) and keeps the newest, as the real driver does. To
simulate a slow sender, deliver bytes at the rate they would arrive.

## touchio

| Function | Returns | Notes |
|---|---|---|
| `touchRead(pin)` | 0 to 65535 | 65535 means touched fully |

The first reading sets the baseline. `value` is true when a reading exceeds baseline + 100, as on the
real board. So return a stable untouched level, and a touched level well over 100 above it. Real
readings use a different scale from this one, so `raw_value` will not match a real board.

Touch works on A0 to A5, D8 and D9. The firmware rejects other pins.

## rtc

| Function | Returns | Notes |
|---|---|---|
| `rtcGet()` | seconds since 1970, as a double | Must keep advancing |
| `rtcSet(seconds)` | nothing | `seconds` is a whole number |

A real Metro has no battery, so it starts at 946684800 (2000-01-01) on power up and keeps its time
across soft resets. Start there to match it. Starting at the real time is friendlier, but differs
from the hardware.

## nvm

| Function | Returns | Notes |
|---|---|---|
| `nvmRead(offset, length)` | `Uint8Array` | At least `length` bytes |
| `nvmWrite(offset, data: Uint8Array)` | nothing | |

There are 256 bytes, at offsets 0 to 255. Erased memory reads as 0xFF. Persist them if students should
see their data survive a power cycle, as it does on a real board.

## rotaryio

| Function | Returns | Notes |
|---|---|---|
| `encoderOpen(pinA, pinB)` | id | Any integer. Start counting from 0 here |
| `encoderRead(id)` | signed count | Total quadrature edges, not detents |
| `encoderWrite(id, count)` | nothing | Python set `position`. Continue counting from `count` |
| `encoderClose(id)` | nothing | |

Count one per edge, using the same direction as the real decoder. With state written as `AB`:

| Direction | Sequence |
|---|---|
| +1 | 00, 10, 11, 01, 00 |
| -1 | 00, 01, 11, 10, 00 |

The firmware applies the divisor with the real algorithm. Partial detents are kept, so 4 edges is one
detent at the default divisor. It reads the count only when Python reads `position`, so a reversal
between two reads collapses into the net movement.

## pulseio

| Function | Returns | Notes |
|---|---|---|
| `pulseinOpen(pin, idleState)` | id | `idleState` is 0 or 1. **Capture starts now**, as on the real board |
| `pulseinResume(id, triggerMicros)` | nothing | Capture restarts from now, ignoring the first edge again |
| `pulseinPause(id)` | nothing | Stop capturing. Keep what is queued |
| `pulseinClear(id)` | nothing | Discard the queue |
| `pulseinCount(id)` | number | Pulses queued |
| `pulseinPop(id)` | length in us, or -1 | Oldest first. Do not cap it: the firmware caps it at 65535 |
| `pulseinClose(id)` | nothing | |
| `pulseoutSend(pin, frequency, dutyCycle, pulses: Uint16Array)` | nothing | See below |

**`PulseIn`.** Queue the time between each pair of edges, skipping the first edge after opening or
resuming, because the first edge only starts the timing. Pulses alternate active and idle.

The firmware keeps the real ring buffer, so it handles `maxlen`, `paused`, indexing and the
"Input taking too long" error. It only collects pulses when Python looks at the object, so keep at
least 1024 pulses queued. Dropping the oldest beyond that is fine.

**Trigger pulses.** When `triggerMicros` is above 0, the pulse has already finished by the time
`pulseinResume` is called. You will have seen it as `pinMode` output, `pinWrite` to the active level,
`pinWrite` back to idle, then `pinMode` input. A part such as a DHT sensor should start replying
when `pulseinResume` arrives.

**`PulseOut`.** `pulses` alternates on and off times, starting with on. `on` means the carrier at
`frequency` and `dutyCycle` (0 to 65535), and the pin is low otherwise.

Return immediately. **The firmware blocks for the total duration itself**, so Python and Stop keep
working. If you do block, it only waits for whatever time remains.

## audioio

| Function | Returns | Notes |
|---|---|---|
| `audioStart(pin, sampleRate, channels)` | nothing | Called for each `play()`. `channels` is always 1 |
| `audioWrite(samples: Int16Array)` | nothing | Add to the queue |
| `audioStop(pin)` | nothing | Discard the queue and stop |
| `audioPause(pin, paused: boolean)` | nothing | **New.** Freeze or resume the queue |
| `audioBufferedMs()` | whole ms | Audio queued and not yet heard |

The firmware fills the queue to about 120ms, using `audioBufferedMs` to stay ahead. Three things
depend on this function:

- It must fall in real time as audio plays, or playback stalls.
- It must reach 0 when the queue runs out, because `playing` stays true until it does.
- It must hold still while paused.

Samples are signed 16 bit. 8-bit and unsigned samples are converted first. The chip has one DAC, so
a stereo sample arrives as its first channel only, as on the real board. Samples are not reduced
to the DAC's 10 bits.

## audiobusio

| Function | Returns | Notes |
|---|---|---|
| `i2sStart(pin, sampleRate, channels)` | nothing | `pin` is the data pin. `channels` is 1 or 2 |
| `i2sWrite(samples: Int16Array)` | nothing | Stereo is interleaved, left first |
| `i2sStop(pin)` | nothing | |
| `i2sPause(pin, paused: boolean)` | nothing | **New** |
| `i2sBufferedMs()` | whole ms | **New.** Same rules as `audioBufferedMs` |
| `pdmRead(sampleCount, sampleRate)` | `Int16Array` | Signed, centred on 0, at least `sampleCount` long |

Return from `pdmRead` immediately. It is called with up to 256 samples at a time, and the firmware
blocks for the recording's real length. Python sees unsigned values centred on 32768, as from the real
filter. `sampleRate` is the real rate after clock rounding: asking for 16000 gives 15957.

## USB

All of these are **new**. The firmware behaves as if a computer is always attached and has accepted
whatever `boot.py` configured.

| Function | Returns | Notes |
|---|---|---|
| `cdcWrite(data: Uint8Array)` | nothing | Written to `usb_cdc.data`. Off until `boot.py` enables it |
| `cdcAvailable()` | number | Bytes waiting for `usb_cdc.data` |
| `cdcRead()` | byte, or -1 | |
| `hidSend(reportId, report: Uint8Array)` | nothing | `report` excludes the report ID. By default: keyboard 1, mouse 2, consumer control 3 |
| `midiWrite(data: Uint8Array)` | nothing | Raw MIDI bytes from `usb_midi.ports[1]` |
| `midiAvailable()` | number | Bytes waiting for `usb_midi.ports[0]` |
| `midiRead()` | byte, or -1 | |

A keyboard report is 8 bytes: modifiers, a reserved byte, then up to 6 keycodes. `adafruit_hid` sends
one report per change, so a key press is a report with the key set, then one with it clear.

The computer cannot send HID reports to the board, so keyboard LED state never changes.

## Functions beyond the original list

`parallelWrite`, `delayUs` (optional), `audioPause`, `i2sPause`, `i2sBufferedMs`, `cdcWrite`,
`cdcAvailable`, `cdcRead`, `hidSend`, `midiWrite`, `midiAvailable`, `midiRead`.
