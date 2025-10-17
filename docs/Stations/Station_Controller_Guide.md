# Station Controller Guide (v1.2.1 – 2025-10-16)
## Overview
Each Station Controller interfaces with the Main Controller via Ethernet (UDP).  
It controls local relays, reads inputs, and reports feedback.  
Optional TM1637 display shows station ID and error status.

## Hardware Summary
| Function | Pin(s) | Notes |
|-----------|--------|-------|
| Relay Outputs | D2–D7 | Active HIGH (invert if needed) |
| Feedback Inputs | A1–A5 (+ D0,D1 when not debugging) | INPUT_PULLUP |
| Analog Input | A6 | Treated as additional feedback bit |
| Station ID Button | A7 | Analog-only, 10kΩ pull-up |
| Ethernet (W5500) | MOSI=D11, MISO=D12, SCK=D13, CS=D10, RST=A0 | Shared seed/reset pin |
| Display (TM1637) | CLK=D8, DIO=D9 | Optional |

## Communication Protocol
- UDP Port: **8888**
- Main Controller IP: **192.168.1.1**
- Station IP: **192.168.1.(10 + ID)**

### Commands
`[0xAA, stationId, 0x01, bitfield, checksum]`  
Apply relay states per bitfield (LSB = relay 0).

### Heartbeat
`[0xAB, stationId, 0x00, checksum]` every 500 ± jitter ms.

### Feedback
`[0xAC, stationId, bits, 0x00, checksum]` when input or analog change detected.

## Watchdog
If no valid command received for 1s:
- Relays **remain in last state** (safe mode)
- TM1637 display flashes “ERRx” (x = Station ID)

## Display Behavior
| State | Display |
|--------|----------|
| Normal | Station ID (0–5) |
| Error | Flashing `ERRx` |
| Vegas Mode | 9999 → 0000 countdown |

## EEPROM
Stores the station ID persistently (0–5).  
Auto-wraps and protects EEPROM life using `.update()`.

## Debug Mode
When `DEBUG_SERIAL = true`:
- Uses USB Serial for diagnostics.
- Frees D0–D1 from feedback inputs.
- Displays RX/TX activity logs.

## Firmware Settings
```cpp
#define FIRMWARE_VERSION "v1.2.1 (2025-10-16)"
#define DEBUG_SERIAL true
#define HAS_TM1637 0
const bool ENABLE_VEGAS_MODE = true;
```

## Maintenance Tips
- Use quality shielded Ethernet cables.
- Confirm all GNDs are common across stations.
- Relays retain last commanded state if link drops.
- Verify A7 pull-up (10kΩ to +5V) for stable button input.
