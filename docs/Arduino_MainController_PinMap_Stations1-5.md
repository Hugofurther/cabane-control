# Arduino Mega Pin Allocation — Main Controller (Stations 1–5)

## ✅ 1️⃣ Overview

| Station | Switches (Outputs) | LED Pairs (2 per switch) | LED Pins | Switch Inputs | **Total Pins** |
|----------|--------------------|---------------------------|-----------|----------------|----------------|
| 1 | 8 | 8 | 16 | 8 | 24 |
| 2 | 4 | 4 | 8 | 4 | 12 |
| 3 | 4 | 4 | 8 | 4 | 12 |
| 4 | 3 | 3 | 6 | 3 | 9 |
| 5 | 2 | 2 | 4 | 2 | 6 |
| **TOTAL** | **21 outputs (switch control)** | **21 LED pairs** | **42 LED pins** | **21 inputs** | **63 total** |

---

## ✅ 2️⃣ Pins to Avoid

- **Pins 0 & 1** → Serial (USB TX/RX)
- **Pins 50–53** → SPI (used by W5500)
- **Pin 10** → Ethernet CS
- **Pin 9** → Ethernet RESET

---

## ✅ 3️⃣ Pin Allocation (Safe Layout)

### 🔹 Station 1 (8 switches + 8 LED pairs)
- **Inputs (8):** 22–29
- **LED_A (8):** 30–37
- **LED_B (8):** 38–45

### 🔹 Station 2 (4 switches + 4 LED pairs)
- **Inputs (4):** 46–49
- **LED_A (4):** 54–57
- **LED_B (4):** 58–61

### 🔹 Station 3 (4 switches + 4 LED pairs)
- **Inputs (4):** 62–65
- **LED_A (4):** 66–69
- **LED_B (4):** A8–A11 *(pins 70–73)*

### 🔹 Station 4 (3 switches + 3 LED pairs)
- **Inputs (3):** A12–A14 *(74–76)*
- **LED_A (3):** A15–A17 *(77–79)*
- **LED_B (3):** A18–A20 *(80–82)*

### 🔹 Station 5 (2 switches + 2 LED pairs)
- **Inputs (2):** A21–A22 *(83–84)*
- **LED_A (2):** A23–A24 *(85–86)*
- **LED_B (2):** A25–A26 *(87–88)*

> ⚙️ *Note:* On Arduino Mega, analog pins can be used as digital pins — numeric aliases (70–85) correspond to A0–A15, and higher Axx pins are also valid.

---

## ✅ 4️⃣ Summary of Used Pin Ranges

| Usage | Pin Range | Count |
|--------|------------|--------|
| Inputs | 22–29, 46–49, 62–65, 74–76, 83–84 | 21 |
| LED_A | 30–37, 54–57, 66–69, 77–79, 85–86 | 21 |
| LED_B | 38–45, 58–61, 70–73, 80–82, 87–88 | 21 |
| **Total** | | **63 pins used** |

---

## ✅ 5️⃣ Implementation Notes

1. Update `IN_PINS[]`, `LED_A[]`, and `LED_B[]` arrays in `Main_Controller_Binary_Detailed.ino`.
2. Set array lengths: `NUM_INPUTS = 21`, `NUM_LED_PAIRS = 21`.
3. Extend loops and frame logic to include Stations 4 and 5.
4. Keep all Ethernet and Serial pins untouched.
    