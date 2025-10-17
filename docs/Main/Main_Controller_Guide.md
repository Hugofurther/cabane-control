# Main Controller Guide (v2.0.0 – 2025-10-16)
## Overview
The Main Controller coordinates up to six Station Controllers (IDs 0–5) over Ethernet using the W5500 module.  
It manages relay states, monitors inputs, provides LED feedback, and performs station overrides.

## Pin Assignments
| Function | Pins | Notes |
|-----------|------|-------|
| Switch Inputs (21) | D2–D21 + D1 | D1 used only when SERIAL_DEBUG = false |
| LED Outputs (42) | D24–D69 | Even = LED_A (Red), Odd = LED_B (Green) |
| Ethernet CS | D22 | W5500 Chip Select |
| Ethernet RESET | D23 | Reset pin |
| SPI (Ethernet) | D50–D53 | MOSI=51, MISO=50, SCK=52, SS=53 (set HIGH) |
| MCP23017 | Removed | Not used |
| Power | +5V regulated | Logic and relays powered through 5V rail |

## Network Configuration
- Main Controller IP: **192.168.1.1**
- Station IPs: **192.168.1.10 – 192.168.1.15**
- UDP Port: **8888**
- MAC base: `DE:AD:BE:EF:02:10 + stationId`

## Communication Protocol
### Command (Main → Station)
`[0xAA, stationId, 0x01, bitfield, checksum]`
- bitfield: LSB = OUT0 → controls relay outputs
- checksum = XOR of first 4 bytes

### Heartbeat (Station → Main)
`[0xAB, stationId, 0x00, checksum]` every 500 ms ± jitter

### Feedback (Station → Main)
`[0xAC, stationId, bits, 0x00, checksum]` whenever inputs change

## LED Status Logic
| State | LED Pattern |
|--------|-------------|
| Station Enabled & Connected | Solid Green |
| Station Enabled but Disconnected | Alternating Red/Green (250 ms) |
| Station Disabled | OFF |
| No Ethernet Link | Flashing Red on all pairs |

## Override Logic
- Station 0 (A3): Forces ON relays tied to inputs 4, 5, 11, 16.  
- Station 4 (A4): Forces ON relay tied to input 19.  
- Overrides take precedence over physical switches until released.

## EEPROM
Stores station enable/disable states persistently.  
Wear-protected using `EEPROM.update()` only on change.

## Vegas Mode
When enabled, cycles all LEDs in diagnostic pattern on startup.

## Debugging
- Enable `SERIAL_DEBUG = true` for serial prints via USB.  
- Displays live network and feedback messages.

## Maintenance Notes
- Ensure Ethernet cable connection before startup.
- Relays retain last valid state if communication is lost.
- Recommended supply: 5V 2A for full LED load.
