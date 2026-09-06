Here are the manuals for your Maple Syrup Farm Control System.

***

# Part 1: Wiring & Hardware Manual

## A. System Power
*   **System Voltage:** 12VDC or 24ΩVDC (Main Power Supply).
*   **Logic Voltage:** 5VDC (Arduino).
*   **Step-Down:** Use buck converters to drop Main Voltage to 9V (Vin) or 5V (5V Pin) for the Arduinos.
*   **Grounding:** **CRITICAL.** The 24VDC GND, 12VDC GND, and Arduino GND must all be connected (Common Ground) for signals to work.

---

## B. Main Controller Wiring (Arduino MEGA 2560)

### 1. Ethernet (W5500 Module)
*   **MISO:** Pin 50
*   **MOSI:** Pin 51
*   **SCK:** Pin 52
*   **CS (Chip Select):** Pin 48
*   **RESET:** Pin 49
*   **Power:** 5V / GND

### 2. Inputs & Outputs
| Component | Pin / Address | Notes |
| :--- | :--- | :--- |
| **Switches 0–7** | D62 – D69 | Physical Pins. Active LOW (Connect to GND). |
| **Switches 8–15** | MCP23017 (Port A) | I2C Addr 0x27. Active LOW. |
| **Switches 16–23** | MCP23017 (Port B) | I2C Addr 0x27. Active LOW. |
| **MCP Interrupts** | D18 (Int A), D19 (Int B) | |
| **I2C Bus** | D20 (SDA), D21 (SCL) | For MCP23017. |
| **Buzzer** | D2 | Active HIGH (Transistor driver recommended). |
| **LEDs (Red/Green)** | Array (D4-D17, D22-D47, D54-61) | Even = Red, Odd = Green. |

---

## C. Station Controller Wiring (Arduino Nano)

### 1. Ethernet (W5500 Module)
*   **MISO:** D12
*   **MOSI:** D11
*   **SCK:** D13
*   **CS:** D10
*   **RESET:** A0 (Configured as Digital Output)

### 2. Peripherals
*   **Display (TM1637):** CLK = D8, DIO = D9.
*   **Station Cycle Button:** Pin A7 (Connect button between A7 and GND). *No resistor needed (Analog logic).*

### 3. The "Analog Ladder" (Feedback Pin A6)
Since the Station Controller ran out of digital pins (and D0/D1 conflict with USB), **Pin A6** is used to read two switches (Input 6 and Input 7) simultaneously using a voltage divider network.

**Resistor Configuration:**
1.  **Pull-Up:** Connect a **3.3kΩ** resistor between **Pin A6** and **+5V**.
2.  **Input 6 (Cable Brown):** Connect the Optocoupler/Switch signal to **Pin A6** via a **1kΩ** resistor.
3.  **Input 7 (Cable Orange):** Connect the Optocoupler/Switch signal to **Pin A6** via a **2.2kΩ** resistor.

*Note: The Switch/Optocoupler must connect the other side of the resistor to **GND** when active.*

### 4. 15-Core Station Connector Pinout
This cable connects the Station Controller box to the Pumps/Sensors/Relays.

| Cable Color | Function | Arduino Pin | Logic / Notes |
| :--- | :--- | :--- | :--- |
| **Red** | Feedback 1 | A1 | Active LOW (GND) |
| **Blue** | Feedback 2 | A2 | Active LOW (GND) |
| **White** | Feedback 3 | A3 | Active LOW (GND) |
| **Green** | Feedback 4 | A4 | Active LOW (GND) |
| **Yellow** | Feedback 5 | A5 | Active LOW (GND) |
| **Brown** | Feedback 6 | **A6** | **Via 1kΩ Resistor** (See Section C.3) |
| **Orange** | Feedback 7 | **A6** | **Via 2.2kΩ Resistor** (See Section C.3) |
| **Purple** | Relay 1 | D2 | Active HIGH |
| **Gray** | Relay 2 | D3 | Active HIGH |
| **White / Red** | Relay 3 | D4 | Active HIGH |
| **Red / White** | Relay 4 | D5 | Active HIGH |
| **Blue / White** | Relay 5 | D6 | Active HIGH |
| **Green / White** | Relay 6 | D7 | Active HIGH |
| **Yellow / Red** | **GND** | GND | Common Ground |
| **Black** | **24V+** | Vin / DC+ | Power for Relays/Optos |

***

# Part 2: Operator's Manual

## 1. System Overview
This system controls 6 pumping stations (ST0–ST5). The Main Controller provides a visual overview of all pumps and vacuum status. It communicates with stations over Ethernet.

### LED Status Codes
*   🔴 **Solid RED:** The device is OFF or Idle.
*   🟢 **Solid GREEN:** The device is ON and Running.
*   🔴 **Flashing RED:** **ALARM.** Vacuum loss detected (Pump is commanded ON, but Vacuum sensor is OFF).
*   🔴🟢 **Alternating RED/GREEN:** **COMMUNICATION ERROR.** The Main Controller cannot talk to that Station.

---

## 2. The Switches
There are 24 switches on the Main Panel.

### Station 0 (Main Building / Tank)
| Switch | Function | Relay Wire # | Relay Wire Color | Feedback Wire # | Feedback Color # |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **2** | Vacuum Pump 1 | 8 | PURPLE | Station 1 | Station 1 |
| **3** | Vacuum Pump 2 | 9 | GRAY | Station 1 | Station 1 |
| **22** | **Thermostat Enable** (See Section 4) | --- |  --- | 4 | GREEN

### Station 1
| Switch | Function | Relay Wire # | Relay Wire Color | Feedback Wire # | Feedback Color # |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **0** | Transport Pump 1 | 8 | PURPLE | 1 | RED |
| **1** | Transport Pump 2 | 9 | GRAY | 2 | BLUE |
| **2** | Vacuum 1 | Station 0 | Station 0 | 3 | WHITE |
| **3** | Vacuum 2 | Station 0 | Station 0 | 3 | WHITE |
| **4** | Vid T1 | 10 | WHITE / RED | 4 | GREEN |
| **5** | Overture T2 | 11 | RED / WHITE | 5 | YELLOW|
| **6** | Vid T2 | 12 | BLUE WHITE | 6 | BROWN |
| **7** | Vid ST2 -> ST1 | 13 | GREEN WHITE | 7 | ORANGE |

### Station 2
| Switch | Function | Relay Wire # | Relay Wire Color | Feedback Wire # | Feedback Color # |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **8** | Transport Pump | 8 | PURPLE | 1 | RED |
| **9** | Vacuum | 9 | GRAY |  2 | BLUE |
| **10** | Vid ST1 -> ST2 | 10 | WHITE / RED | 3 | WHITE |
| **11** | Vid ST3 -> ST2 | 11 | RED / WHITE | 4 | GREEN |

### Station 3
| Switch | Function | Relay Wire # | Relay Wire Color | Feedback Wire # | Feedback Color # |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **12** | Transport Pump 1 | 8 | PURPLE | 1 | RED |
| **13** | Transport Pump 2 | 9 |GRAY | 2 | BLUE |
| **14** | Vacuum | 10 | WHITE / RED | 3 | WHITE |
| **15** | Vid ST2 -> ST3 | 11 | RED / WHITE | 4 | GREEN |

### Station 4
| Switch | Function | Relay Wire # | Relay Wire Color | Feedback Wire # | Feedback Color # |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **16** | Transport Pump | 8 | 1 | RED |
| **17** | Vacuum | 9 | 2 | BLUE |
| **18** | Vid ST4 | 10 | 3 | WHITE |
| **23** | **Thermostat Enable** (See Section 4) | --- | --- | 4 | GREEN |

### Station 5
| Switch | Function | Relay Wire # | Relay Wire Color | Feedback Wire # | Feedback Color # |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **19** | Transport Pump | 8 | PURPLE | 1 | RED |
| **20** | Vid ST5 | 9 | GRAY | 2 | BLUE |

### Global Controls
| Switch | Function |
| :--- | :--- |
| **21** | **Buzzer Mute / Enable** |

---

## 3. Vacuum Alarm & Buzzer
The system monitors vacuum levels on Stations 1, 2, 3, and 4.

**Trigger Condition:**
An alarm is triggered if a Vacuum Pump is commanded to run (via Switch OR Thermostat), but the feedback sensor indicates **No Vacuum**.

**Visual:**
The LED pair for that pump will **Flash RED** if an alarm occurs, otherwise the LED pair is GREEN.

**Audible Alarm (Buzzer):**
The buzzer behavior depends on **Switch 21**:
*   **Switch 21 ON:** The buzzer is ARMED. If an alarm occurs, the buzzer sounds a siren.
*   **Switch 21 OFF:** The buzzer is MUTED.
    *   *Reminder Feature:* If the system is running properly but the Buzzer is Muted, the panel will chirp once every 5 minutes to remind you to arm the alarm.

---

## 4. Thermostat Automation
Stations 0 and 4 have temperature automation capabilities.

**How it works:**
1.  **Enable:** Flip Switch **22** (for ST0) or **23** (for ST4) to the **ON** position.
    *   If the temperature is too cold, the LED will be **RED** (Standby).
    *   If the temperature is warm enough, the LED will turn **GREEN** (Active).
2.  **Action:** When the Thermostat becomes **Active (Green)**, it automatically overrides and turns **ON** specific pumps, regardless of their manual switch position.

**Overrides:**
*   **Thermostat 1 (ST0):** Turns ON switches **2, 9, 14** (Vacuum pumps on ST0, ST2, ST3).
*   **Thermostat 2 (ST4):** Turns ON switch **17** (Vacuum pump on ST4).

*Note: If a Vacuum Alarm occurs during Thermostat operation (e.g., Thermostat turns on pump, but vacuum fails), the Alarm logic and Buzzer will trigger exactly as if you had turned the switch on manually.*

---

## 5. Station Setup (Technician Only)
If a Station Controller is replaced or moved:

1.  **Connect:** Plug in Ethernet and the 15-core cable.
2.  **Power Up:** The Display will show the current Station ID.
3.  **Assign ID:**
    *   Press the **Cycle Button** (on the Station box).
    *   The number will shift left and increment (0 $\to$ 1 $\to$ 2... $\to$ 5 $\to$ 0).
    *   Stop pressing when the desired Station Number is shown.
    *   Wait 2 seconds. The number will shift to the right.
4.  **Verify:**
    *   If the number stays solid, the ID is assigned and connected.
    *   If the display shows **"Err"**, there is a network error.
    *   If the ID reverts to a different number, that ID was already taken by another station on the network.
    