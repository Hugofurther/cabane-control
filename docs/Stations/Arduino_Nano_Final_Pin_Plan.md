# Arduino Nano Final Pin Plan (with W5500 + TM1637)

## ✅ Pin Assignments

| Function | Pin(s) | Notes |
|-----------|--------|-------|
| **Seed analog (random)** | A0 | Read once before reuse |
| **Ethernet reset (ETH_RST)** | A0 | Set OUTPUT after seeding |
| **Feedback inputs (7)** | A1–A5, D0, D1 | Only when `DEBUG_SERIAL == false` |
| **Extra input (1)** | A6 | Analog-only, treat like A7 |
| **Pushbutton (Cycle Station)** | A7 | Analog-only |
| **Relay outputs (6)** | D2, D3, D4, D5, D6, D7 | — |
| **TM1637 Display** | D8 = CLK, D9 = DIO | — |
| **W5500 Ethernet** | D10 (CS), D11 (MOSI), D12 (MISO), D13 (SCK) | Built-in LED also on D13 (don’t drive) |

---

## ⚠️ Important Wiring & Firmware Notes

### A6 & A7 (Analog-only)
- No `pinMode()` or internal pullups.
- Use **external 10 kΩ resistor** (pull-up or pull-down).
- Example (pull-up): 10 kΩ from A7 → +5 V, button from A7 → GND.
- Threshold: pressed `<200`, released `>300`.

### D0 & D1 (Digital inputs when not debugging)
- Configure as `INPUT_PULLUP`.
- Add **1–4.7 kΩ series resistor** between pin and GND via switch.
- Do **not** press switches on D0/D1 during uploads or Serial debugging.

### A0 dual use (seed → ETH_RST)
1. `randomSeed(analogRead(A0) ^ micros());`
2. Then `pinMode(A0, OUTPUT)`.
3. Pulse LOW→HIGH (10–100 ms) to reset W5500.

### Debounce
- Keep your existing **25 ms debounce** for all inputs.
- For A6/A7, debounce after analog thresholding.

---

## Summary
This configuration ensures:
- Reliable Ethernet reset sequence (A0 shared safely)
- Clean digital feedback inputs (A1–A5, D0, D1)
- Analog-based pushbutton (A7) and extra input (A6)
- No SPI or TM1637 interference
- Safe upload/debugging behavior when Serial active
	