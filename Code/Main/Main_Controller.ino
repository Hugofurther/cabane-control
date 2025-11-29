/*
  ==============================================================
  MAIN CONTROLLER — BASELINE REBUILD STEP 1
  Hardware-level initialization + MCP/LED/Vegas diagnostic only
  ==============================================================
*/
// -------------------- SYSTEM DEFINES --------------------
#define FIRMWARE_VERSION "v1.0-RebuildStep1"
#define DEBUG_SERIAL 0      // for the else clauses
#define DEBUG_LEVEL 0       // 0 = Off, 1 = Errors only, 2 = Normal, 3 = Verbose
#define BUZZER_REMINDER 1   // 1 = enable periodic reminder beep, 0 = disable
#define ENABLE_VEGAS_MODE 1 // Set false to skip startup LED test

// ============================================================
// 🧩 SECTION: INCLUDE LIBRARIES
// ============================================================
#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <EEPROM.h>
#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#include <avr/wdt.h>

// ============================================================
// 🚧 SECTION: DEBUG CONFIG
// ============================================================

// Limit how often serial debug lines are printed
// ---------------- DEBUG CONFIG ----------------
const uint16_t DBG_THROTTLE_MS[4] = {0, 0, 1000, 3000}; // Minimum delay between same-level prints
uint32_t dbgLastPrint[4] = {0, 0, 0, 0};                // timestamp to throttle serial prints

#define DBG(level, x)                                           \
  do                                                            \
  {                                                             \
    if ((level) <= DEBUG_LEVEL)                                 \
    {                                                           \
      uint32_t _now = millis();                                 \
      if (_now - dbgLastPrint[level] >= DBG_THROTTLE_MS[level]) \
      {                                                         \
        dbgLastPrint[level] = _now;                             \
        x;                                                      \
      }                                                         \
    }                                                           \
  } while (0)
// DBG(1, Serial.println(F("[ERR] No command received")));    // Error-level
// DBG(2, Serial.println(F("[TX ] Heartbeat sent")));         // Normal info
// DBG(3, Serial.print(F("[RX ] Data=")));                    // Verbose details

// ============================================================
// 🧩 SECTION: HARDWARE CONFIGURATION & CONSTANTS
// ============================================================

// --- MCP23017 ---
#define MCP_I2C_ADDR 0x27 // DIP-switch address
#define MCP_INTA_PIN 18   // interrupt from port A
#define MCP_INTB_PIN 19   // interrupt from port B

Adafruit_MCP23X17 mcp; // ✅ new class name

// ============================================================
// 🌐 SECTION: NETWORK CONFIGURATION
// ============================================================
#define ETH_CS 48
#define ETH_RESET 49
const uint16_t UDP_PORT = 8888;
EthernetUDP Udp; // Single socket for RX/TX

byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED};

// Fixed IPs per design
IPAddress ipMain(192, 168, 1, 1); // This Mega
IPAddress ipS0(192, 168, 1, 10);  // Station 0
IPAddress ipS1(192, 168, 1, 11);  // Station 1
IPAddress ipS2(192, 168, 1, 12);  // Station 2
IPAddress ipS3(192, 168, 1, 13);  // Station 3
IPAddress ipS4(192, 168, 1, 14);  // Station 4
IPAddress ipS5(192, 168, 1, 15);  // Station 5

// ============================================================
// 🔔 BUZZER ALERT MODE CONFIGURATION
// ============================================================

// 0 = Continuous tone when active (default legacy behavior)
// 1 = Pulsed tone (on/off cycle while alert active)
#define BUZZER_ALERT_MODE 1

// --- Only used if BUZZER_ALERT_MODE == 1 ---
#define BUZZER_ALERT_ON_MS 5000   // 5 seconds ON   <-- MAKE SURE THIS LINE IS HERE
#define BUZZER_ALERT_OFF_MS 10000 // 10 seconds OFF

// ============================================================
// 🔔 BUZZER + VACUUM ALERT STATE
// ============================================================
#define PIN_BUZZER 2

bool anyVacuumAlert = false;          // set true when any vacuum fault detected
const uint8_t BUZZER_SWITCH_IDX = 21; // index in stableState[]
#define BUZZER_LED_PAIR 21            // LED pair index

// -------------------- BUZZER REMINDER --------------------
#if BUZZER_REMINDER
// --- BUZZER REMINDER TIMING ---
bool buzzerPulseActive = false;
uint32_t buzzerTimer = 0;
// Reminder timing
const uint32_t REMINDER_PERIOD_MS = 300000; // total cycle length (60 seconds)
const uint32_t REMINDER_ON_MS = 500;        // buzzer ON duration inside cycle (1 second)
#endif

// -------------------- INPUT / OUTPUT COUNTS --------------------
#define NUM_STATIONS 6
#define NUM_INPUTS 8 // only the physical ones read directly
#define NUM_LED_PAIRS 24
#define TOTAL_INPUTS (NUM_INPUTS + 16) // 8 physical + 16 MCP

// ============================================================
// 🧩 Unified Debounce System (for all physical + MCP inputs)
// ============================================================
bool rawState[TOTAL_INPUTS] = {0};       // instantaneous reads
bool stableState[TOTAL_INPUTS] = {0};    // debounced result
uint32_t lastChange[TOTAL_INPUTS] = {0}; // last time each input changed
const uint16_t DEBOUNCE_MS = 50;         // adjust as needed (30–80ms typical)

// -------------------- PHYSICAL SWITCH INPUTS --------------------
const uint8_t PHYS_SW_PINS[NUM_INPUTS] = {62, 63, 64, 65, 66, 67, 68, 69};

// -------------------- LED ARRAYS --------------------
const uint8_t LED_A[NUM_LED_PAIRS] = { // 🔴 RED pins (even)
    4, 6, 8, 10, 12, 14, 16,
    22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46,
    54, 56, 58, 60};

const uint8_t LED_B[NUM_LED_PAIRS] = { // 🟢 GREEN pins (odd)
    5, 7, 9, 11, 13, 15, 17,
    23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47,
    55, 57, 59, 61};

// ============================================================
// 🧩 Input Mapping Configuration
// ============================================================

struct InputMap
{
  uint8_t index;    // global stableState[] index
  bool isMCP;       // true if from MCP23017, false if physical pin
  uint8_t pinOrBit; // digital pin (if physical) or MCP bit (0–7)
  uint8_t mcpId;    // 0 = Port A, 1 = Port B
  uint8_t station;  // station number (0–5)
  uint8_t bit;      // bit index (0–7) within that station
};

// ============================================================
// 📘 Unified Input Map Table
// ============================================================
//
// NOTE: indices (index) must match stableState[] layout
//       0–7   → physical pins
//       8–15  → MCP Port A bits
//       16–23 → MCP Port B bits
//
const InputMap INPUT_MAP[] = {
    // index, isMCP, pinOrBit, mcpId, station, bit

    // --- Physical pins (directly on Mega) ---
    {0, false, 62, 0, 1, 0}, // Switch 0 - not mcp - Pin 62 - ST1 OUT - D2 - Transp 1
    {1, false, 63, 0, 1, 1}, // Switch 1 - not mcp - Pin 63 - ST1 OUT - D3 - Transp 1
    {2, false, 64, 0, 0, 0}, // Switch 2 - not mcp - Pin 64 - ST0 OUT - D2 - Vac 1
    {3, false, 65, 0, 0, 1}, // Switch 3 - not mcp - Pin 65 - ST0 OUT - D3 - Vac2
    {4, false, 66, 0, 1, 2}, // Switch 4 - not mcp - Pin 66 - ST1 OUT - D4 - Vid T1
    {5, false, 67, 0, 1, 3}, // Switch 5 - not mcp - Pin 67 - ST1 OUT - D5 - Ouver T2
    {6, false, 68, 0, 1, 4}, // Switch 6 - not mcp - Pin 68 - ST1 OUT - D6 - Vid T2
    {7, false, 69, 0, 1, 5}, // Switch 7 - not mcp - Pin 69 - ST1 OUT - D7 - Vid ST2 -> ST1

    // --- MCP23017 Port A (GPA0–7) ---
    {8, true, 0, 0, 2, 0},  // Switch 8 - isMCP - Bit A0  - ST2 OUT - D2 - Transp
    {9, true, 1, 0, 2, 1},  // Switch 9 - isMCP - Bit A1 - ST2 OUT - D3 - Vac
    {10, true, 2, 0, 2, 2}, // Switch 10 - isMCP - Bit A2 - S2 OUT - D4 - Vid ST1 -> ST2
    {11, true, 3, 0, 2, 3}, // Switch 11 - isMCP - Bit A3 - ST2 OUT - D5 - Vid ST33 -> ST2

    {12, true, 4, 0, 3, 0}, // Switch 12 - isMCP - Bit A4 - ST3 OUT - D2 - Transp 1
    {13, true, 5, 0, 3, 1}, // Switch 13 - isMCP - Bit A5 - ST3 OUT - D3 - Transp 2
    {14, true, 6, 0, 3, 2}, // Switch 14 - isMCP - Bit A6 - ST3 OUT - D4 - Vac
    {15, true, 7, 0, 3, 3}, // Switch 15 - isMCP - Bit A7 - ST3 OUT - D5 - Vid ST2 -> ST3

    // --- MCP23017 Port B (GPB0–7) ---
    {16, true, 0, 1, 4, 0}, // Switch 16 - isMCP - Bit B0 - ST4 OUT - D2 - Transp
    {17, true, 1, 1, 4, 1}, // Switch 17 - isMCP - Bit B1 - ST4 OUT - D3 - Vac
    {18, true, 2, 1, 4, 2}, // Switch 18 - isMCP - Bit B2 - ST4 OUT - D4 - Vid ST4

    {19, true, 3, 1, 5, 0}, // Switch 19 - isMCP - Bit B3 - ST3 OUT - D2 - Transp
    {20, true, 4, 1, 5, 1}, // Switch 20 - isMCP - Bit B4 - ST3 OUT - D3 - Vid ST5

    {21, true, 5, 1, 255, 0}, // Buzzer switch (no station)
    {22, true, 6, 1, 255, 0}, // TH1 switch (no station)
    {23, true, 7, 1, 255, 0}, // TH2 switch (no station)
};

const uint8_t INPUT_MAP_COUNT = sizeof(INPUT_MAP) / sizeof(INPUT_MAP[0]);

// ============================================================
// 💡 SECTION: LED → Station Ownership Mapping
// ============================================================

// Enumerated station IDs for readability
enum
{
  ST0 = 0,
  ST1,
  ST2,
  ST3,
  ST4,
  ST5
};

// ============================================================
// 🎛️ FEEDBACK → LED Pair Mapping (granular)
// ============================================================
struct LedMap
{
  uint8_t ledPair;       // which LED pair (0–23)
  uint8_t station;       // main feedback station
  uint8_t bit;           // feedback bit index
  int8_t offlineStation; // optional: station to monitor for offline blink (-1 if none)
  bool isVacuum;         // ⬅️ true if this LED is a vacuum indicator
  int8_t switchIndex;    // ⬅️ optional: matching switch index in stableState[]
};

const LedMap LED_MAP[] = {
    // Station 1
    {0, 1, 0, 0, 0, 0}, // pair 0: Station 1 A1, blink if ST0 offline - Transport Pump 1
    {1, 1, 1, 1, 0, 1}, // pair 1: Station 1 A2, blink if ST1 offline - Transport Pump 2
    {2, 1, 2, 1, 1, 2}, // pair 2: Station 1 A3, blink if ST1 offline - Vacuum 1
    {3, 1, 2, 1, 1, 3}, // pair 3: Station 1 A3, blink if ST1 offline - Vacuum 2
    {4, 1, 3, 1, 0, 4}, // pair 4: Station 1 A4, blink if ST1 offline - Vid T1
    {5, 1, 4, 1, 0, 5}, // pair 5: Station 1 A5, blink if ST1 offline - Overture T2
    {6, 1, 5, 1, 0, 6}, // pair 6: Station 1 A6 - val 573, blink if ST1 offline - Vid T2
    {7, 1, 6, 1, 0, 7}, // pair 7: Station 1 A6 - val 634, blink if ST1 offline - VId st2 -> St1
    // Station 2
    {8, 2, 0, 2, 0, 8},   // pair 8: Station 2 A1, blink if ST2 offline - Transport Pump
    {9, 2, 1, 2, 1, 9},   // pair 9: Station 2 A2, blink if ST2 offline - Vacuum
    {10, 2, 2, 2, 0, 10}, // pair 10: Station2 A3, blink if ST2 offline -  Vid ST1 -> ST2
    {11, 2, 3, 2, 0, 11}, // pair 11: Station 2 A4, blink if ST2 offline - Vid ST3 -> ST2
    // Station 3
    {12, 3, 0, 3, 0, 12}, // pair 12: Station 3 A1, blink if ST3 offline - Transport Pump 1
    {13, 3, 1, 3, 0, 13}, // pair 13: Station 3 A2, blink if ST3 offline - Transport Pump 2
    {14, 3, 2, 3, 1, 14}, // pair 14: Station 3 A3, blink if ST3 offline - Vacuum
    {15, 3, 3, 3, 0, 15}, // pair 15: Station 3 A4, blink if ST3 offline - Vid ST2 -> ST3
    // Station 4
    {16, 4, 0, 4, 0, 16}, // pair 16: Station 4 A2, blink if ST4 offline - Transport Pump
    {17, 4, 1, 4, 1, 17}, // pair 17: Station 4 A3, blink if ST4 offline - Vacuum
    {18, 4, 2, 4, 0, 18}, // pair 18: Station 4 A4, blink if ST4 offline - Vid ST4
    // Station 5
    {19, 5, 0, 5, 0, 19}, // pair 19: Station 5 A1, blink if ST5 offline - Transport Pump
    {20, 5, 1, 5, 0, 20}, // pair 20: Station 5 A2, blink if ST5 offline - Vid ST5
};
const uint8_t LED_MAP_COUNT = sizeof(LED_MAP) / sizeof(LED_MAP[0]);

// ============================================================
// 🧩 SECTION: MACROS
// ============================================================
#define LED_RED(idx, on) digitalWrite(LED_A[idx], (on))
#define LED_GREEN(idx, on) digitalWrite(LED_B[idx], (on))
#define LED_PAIR(idx, redOn, greenOn)    \
  do                                     \
  {                                      \
    digitalWrite(LED_A[idx], (redOn));   \
    digitalWrite(LED_B[idx], (greenOn)); \
  } while (0)

#define VEGAS_DELAY_MS 60 // Speed between LEDs (adjust to taste)
#define VEGAS_FLASHES 3   // Number of red/green blinks per station

// -------------------- EEPROM Address --------------------
#define EEPROM_STATION_BASE 0 // start address

// ============================================================
// 🧩 STATION ENABLE/DISABLE MANAGEMENT
// ============================================================

const uint32_t LONGPRESS_MS = 5000; // Hold 5s to toggle enable

bool stationEnabled[NUM_STATIONS] = {true};
bool stationOffline[NUM_STATIONS] = {false};
uint8_t stationFeedback[NUM_STATIONS] = {0};
bool firstHeartbeatSeen[NUM_STATIONS] = {false};

// For long-press detection
bool pressActive[NUM_STATIONS] = {false};
uint32_t pressStart[NUM_STATIONS] = {0};

// Map each station to the input index in stableState[]
const uint8_t stationButtonIndex[NUM_STATIONS] = {
    0,  // Station 0 → first input
    1,  // Station 1 → second input
    8,  // Station 2
    12, // Station 3
    16, // Station 4
    19  // Station 5
};

// ============================================================
// 🌡️ THERMOSTAT SYSTEM CONFIG
// ============================================================

// Global on/off toggle for thermostat feature
#define ENABLE_THERMOSTAT true // Set to false to disable feature entirely

// Thermostat switch input indices (stableState[])
const uint8_t TH_SWITCH_IDX[2] = {22, 23}; // MCP-B6, MCP-B7

// LED pair indices
const uint8_t TH_LED_PAIR[2] = {22, 23};

// Station/feedback mapping
const uint8_t TH_FEEDBACK_STATION[2] = {0, 4}; // Thermostat 1 → Station 0, Thermostat 2 → Station 4
const uint8_t TH_FEEDBACK_BIT[2] = {3, 3};     // Bit positions in stationFeedback[station]

// Override switch indices (multiple allowed)
const uint8_t TH1_OVERRIDE_IDX[] = {2, 9, 14}; // Thermostat 1
const uint8_t TH2_OVERRIDE_IDX[] = {17};       // Thermostat 2
const uint8_t *TH_OVERRIDE_IDX[2] = {TH1_OVERRIDE_IDX, TH2_OVERRIDE_IDX};
const uint8_t TH_OVERRIDE_COUNT[2] = {
    sizeof(TH1_OVERRIDE_IDX) / sizeof(TH1_OVERRIDE_IDX[0]),
    sizeof(TH2_OVERRIDE_IDX) / sizeof(TH2_OVERRIDE_IDX[0])};

// Global Variables
bool thermostatEnabled[2] = {false, false}; // From switches 22, 23
bool thermostatActive[2] = {false, false};  // Based on feedback A1, A4

// ============================================================
// 🧠 RUNTIME VARIABLES
// ============================================================

// --- MCP23017 input tracking ---
volatile bool mcpIntA_Flag = false;
volatile bool mcpIntB_Flag = false;
uint8_t mcpStateA = 0xFF; // bit = 1 means switch not pressed (pull-ups)
uint8_t mcpStateB = 0xFF;

// ============================================================
// 🕒 TIMING CONSTANTS
// ============================================================
const uint16_t SEND_INTERVAL_MS = 50; // Interval between UDP sends to stations (ms)
const uint16_t LINK_CHECK_INTERVAL = 250;
const uint16_t HEARTBEAT_TIMEOUT_MS = 2000; // Mark station offline if no heartbeat within 2s
const uint16_t BLINK_INTERVAL_MS = 250;     // Global blink period for LEDs (ms)

uint32_t lastHeartbeatMs[NUM_STATIONS] = {0};
uint16_t heartbeatCount[NUM_STATIONS] = {0}; // ✅ optional counter
uint32_t lastHeartbeatPrint = 0;             // ✅ Add this near top-level globals
uint32_t tSend = 0;
uint32_t lastLinkCheck = 0;

// --- Buzzer queue ---
uint8_t buzzerHead = 0, buzzerTail = 0;

// --- Buzzer state ---
bool buzzerActive = false;
bool buzzerOn = false;
uint8_t currentPattern = 0;
uint8_t beepStep = 0;
uint32_t beepTimer = 0;
uint32_t lastBuzzerBlinkMs = 0; // time marker for LED blink phase
bool buzzerBlinkPhase = false;  // toggled with buzzer rhythm

// --- LED blink/heartbeat ---

uint32_t tBlink = 0;
bool blinkPhase = false;
uint32_t lastQueuedMs[NUM_STATIONS] = {0}; // per-station re-queue cooldown

// ============================================================
// 🏛️ SECTION: Helper Structures
// ============================================================

// ----------------------------- VACUUM ALERT MAPPING -----------------------------
struct VacuumMap
{
  uint8_t switchIndex[2]; // up to 2 switches per station
  uint8_t ledPair[2];     // up to 2 LED pairs per station
  uint8_t stationID;      // source station for feedback
  uint8_t bitIndex[2];    // which bits in stationFeedback[] correspond
};

// ============================================================
// 🌡️ SECTION: Thermostat Debouncer
// ============================================================
// -------------------------------------------------------------------
// FUNCTION: readThermoDebounced()
// PURPOSE : Samples analog input pins (A3/A4) for thermostat signals,
//           applies debounce filtering, and returns stable logic level.
// -------------------------------------------------------------------
// ************************************************************************************************************************
// bool readThermoDebounced(uint8_t index, uint8_t pin, uint32_t now)
// {
//   bool raw = digitalRead(pin);
//   if (raw != thermoFiltered[index] && (now - lastThermoReadMs[index] >= THERMO_DEBOUNCE_MS))
//   {
//     thermoFiltered[index] = raw;
//   }
//   lastThermoReadMs[index] = now;
//   return thermoFiltered[index];
// }

// ============================================================
// 🧩 UTILITIES
// ============================================================

// ============================================================
// 🔧 FUNCTIONS: MCP23017 Handlers
// ============================================================
// -------------------------------------------------------------------
// Robust MCP23017 interrupt handlers
// Prevents event loss when multiple bits change quickly.
// -------------------------------------------------------------------
void readMcpA()
{
  // Continue reading as long as INT line remains low
  while (digitalRead(MCP_INTA_PIN) == LOW)
  {
    mcpStateA = mcp.readGPIO(0); // read Port A
    delayMicroseconds(50);       // small debounce to let INT settle
  }
  mcpIntA_Flag = false;
}

void readMcpB()
{
  while (digitalRead(MCP_INTB_PIN) == LOW)
  {
    mcpStateB = mcp.readGPIO(1); // read Port B
    delayMicroseconds(50);
  }
  mcpIntB_Flag = false;
}

// ============================================================
// 🧩 Helper: readInputByMap()
// ============================================================
// Reads the current raw logic level (active-high = pressed/on)
// Handles both physical and MCP inputs seamlessly.
//
bool readInputByMap(const InputMap &m)
{
  if (m.isMCP)
  {
    uint8_t portState = (m.mcpId == 0) ? mcpStateA : mcpStateB;
    return ((portState & (1 << m.pinOrBit)) == 0); // active-low logic
  }
  else
  {
    return !digitalRead(m.pinOrBit); // physical pin (active-low)
  }
}

// ============================================================
// 🔧 FUNCTIONS: LED Utilities
// ============================================================

// -------------------------------------------------------------------
// FUNCTION: digitalWriteAll()
// PURPOSE : Writes the same logic state to a contiguous LED array.
//           Used for bulk on/off control (e.g., link down blink).
// -------------------------------------------------------------------
void digitalWriteAll(const uint8_t *pins, uint8_t count, bool state)
{
  for (uint8_t i = 0; i < count; i++)
    digitalWrite(pins[i], state);
}

// ============================================================
// 🔧 FUNCTIONS: Ethernet
// ============================================================

// ============================================================
// 🌐 SECTION: Ethernet Link + LED Status Logic
// ============================================================
void updateEthernetAndLEDs(uint32_t now)
{
  static bool linkDown = false;

  // 1️⃣ Check Ethernet link
  if (now - lastLinkCheck >= LINK_CHECK_INTERVAL)
  {
    lastLinkCheck = now;
    linkDown = (Ethernet.linkStatus() != LinkON);
    DBG(4, Serial.print(F("[LINK] "));
        Serial.println(linkDown ? F("DOWN") : F("OK")));
  }

  // 2️⃣ Link Down → Global RED blink
  if (linkDown)
  {
    digitalWriteAll(LED_B, NUM_LED_PAIRS, LOW);
    digitalWriteAll(LED_A, NUM_LED_PAIRS, blinkPhase);
    return;
  }

  anyVacuumAlert = false; // Reset -> recheck below

  // 3️⃣ Link Up → unified LED update
  for (uint8_t i = 0; i < LED_MAP_COUNT; i++)
  {
    const LedMap &m = LED_MAP[i];

    // --- Disabled main station → OFF
    if (!stationEnabled[m.offlineStation])
    {
      LED_PAIR(m.ledPair, LOW, LOW);
      continue;
    }

    // --- Offline reference station → blink RED/GREEN
    if (m.offlineStation != (uint8_t)-1 && stationOffline[m.offlineStation])
    {
      LED_PAIR(m.ledPair,
               blinkPhase ? HIGH : LOW,
               blinkPhase ? LOW : HIGH);
      continue;
    }

    // 🚨 STATE CALCULATION (Manual Switch vs Thermostat)
    bool bitVal = (stationFeedback[m.station] >> m.bit) & 1; // feedback (1=OFF/Lost)
    bool isCommandedOn = stableState[m.switchIndex];         // Manual Switch

#if ENABLE_THERMOSTAT
    // Check if a Thermostat is forcing this index ON
    for (uint8_t t = 0; t < 2; t++)
    {
      // If Thermostat is Enabled AND Active (calling for heat/vacuum)
      if (thermostatEnabled[t] && thermostatActive[t])
      {
        for (uint8_t k = 0; k < TH_OVERRIDE_COUNT[t]; k++)
        {
          if (m.switchIndex == TH_OVERRIDE_IDX[t][k])
          {
            isCommandedOn = true; // ⚠️ Override Active!
            break;
          }
        }
      }
    }
#endif

    // 🚨 VACUUM ALERT LOGIC
    // Alarm if: (Commanded ON) AND (Feedback says OFF/Loss)
    if (m.isVacuum && isCommandedOn && bitVal)
    {
      anyVacuumAlert = true;

      LED_PAIR(m.ledPair,
               blinkPhase ? HIGH : LOW, // Flash RED
               LOW);
      continue;
    }

    // --- NORMAL STATUS LED
    LED_PAIR(m.ledPair,
             bitVal ? HIGH : LOW,  // RED when relay off (feedback 1)
             bitVal ? LOW : HIGH); // GREEN when relay on (feedback 0)
  }

  // 🔕 Buzzer LED (pair 21) is handled by updateBuzzerLED()
}

// -------------------------------------------------------------------
// FUNCTION: ethernetResetPulse() / initEthernet()
// PURPOSE : Performs controlled hardware reset of W5500 module,
//           initializes Ethernet interface, and retries if no link.
// -------------------------------------------------------------------
void ethernetResetPulse()
{
  // Ensure Mega Hardware SS is inactive (Critical for SPI stability)
  pinMode(53, OUTPUT);
  digitalWrite(53, HIGH);

  // Ensure W5500 is deselected before reset
  pinMode(ETH_CS, OUTPUT);
  digitalWrite(ETH_CS, HIGH);

  // Perform the "Raw Probe" Hard Reset Sequence
  pinMode(ETH_RESET, OUTPUT);
  digitalWrite(ETH_RESET, LOW);
  delay(200); // Hold Low for 200ms (was 10ms)
  digitalWrite(ETH_RESET, HIGH);
  delay(800); // Wait 800ms for PLL lock (was 100ms)
}

// ============================================================
// 🔧 FINAL STABLE INITIALIZATION (Matches Diagnostic Tests)
// ============================================================
void initEthernet()
{
  Serial.println(F("[NET] Starting Network Initialization..."));

  // 1. MANUAL SPI STARTUP
  // Force SPI bus active before library loads
  SPI.begin();

  // 2. HARD RESET (200ms / 800ms)
  Serial.print(F("[NET] Resetting W5500..."));
  pinMode(ETH_RESET, OUTPUT);
  digitalWrite(ETH_RESET, LOW);
  delay(200);
  digitalWrite(ETH_RESET, HIGH);
  delay(800);
  Serial.println(F(" Done."));

  // 3. MANUAL HANDSHAKE (Trust Verify)
  // We talk to the chip manually to ensure it is awake and listening.
  Serial.print(F("[NET] Manual Handshake... "));

  SPI.beginTransaction(SPISettings(8000000, MSBFIRST, SPI_MODE0));
  digitalWrite(ETH_CS, LOW);
  SPI.transfer(0x00); // Address H
  SPI.transfer(0x39); // Address L
  SPI.transfer(0x00); // Control
  byte version = SPI.transfer(0x00);
  digitalWrite(ETH_CS, HIGH);
  SPI.endTransaction();

  if (version == 0x04)
  {
    Serial.println(F("SUCCESS (0x04)"));
  }
  else
  {
    Serial.print(F("WARNING: Read 0x"));
    Serial.print(version, HEX);
    Serial.println(F(". Proceeding anyway..."));
  }

  // 4. FORCE LIBRARY START
  // We skip Ethernet.hardwareStatus() because it is unreliable on this setup.
  // We go straight to begin(), which performs the necessary Soft Reset to sync the library.
  Ethernet.init(ETH_CS);
  Ethernet.begin(mac, ipMain);

  // 5. START UDP
  Udp.begin(UDP_PORT);

  // 6. CONFIGURE RETRIES
  // Maple syrup farms are noisy; if a packet fails, retry quickly.
  Ethernet.setRetransmissionCount(1);
  Ethernet.setRetransmissionTimeout(200);

  // 7. FINAL VERIFICATION
  IPAddress local = Ethernet.localIP();
  Serial.print(F("[NET] Initialization Complete. IP: "));
  Serial.println(local);

  // Halt if IP assignment failed (SPI totally dead)
  if (local[0] == 0 || local[0] == 255)
  {
    Serial.println(F("[NET] CRITICAL ERROR: IP Address invalid. System halted."));
    while (1)
    {
      // Flash the LED or Buzzer to alert operator of hardware failure
      digitalWrite(ETH_RESET, LOW);
      delay(100);
      digitalWrite(ETH_RESET, HIGH);
      delay(100);
    }
  }
}

inline uint8_t xorChecksum(const uint8_t *d, uint8_t l)
{
  uint8_t c = 0;
  for (uint8_t i = 0; i < l; i++)
    c ^= d[i];
  return c;
}

// Efficient bit-packing utility
inline uint8_t packBitsLSB(const bool *arr, uint8_t n)
{
  uint8_t v = 0;
  for (uint8_t i = 0; i < n; i++)
    v |= arr[i] << i;
  return v;
}

// -------------------------------------------------------------------
// FUNCTION: sendSetFrame()
// PURPOSE : Builds and sends 5-byte UDP command frame [AA,id,01,bits,cks]
// INPUTS  : dst (station IP), id (station number), bits (relay bitfield)
// -------------------------------------------------------------------
void sendSetFrame(IPAddress dst, uint8_t id, uint8_t bits)
{
  uint8_t f[5];
  f[0] = 0xAA;
  f[1] = id;
  f[2] = 0x01;
  f[3] = bits;
  f[4] = xorChecksum(f, 4);

  Udp.beginPacket(dst, UDP_PORT);
  Udp.write(f, 5);
  Udp.endPacket();

  DBG(2,
      Serial.print(F("[TX] ST="));
      Serial.print(id);
      Serial.print(F(" BITS="));
      Serial.print(bits, BIN);
      Serial.print(F(" CKS=0x"));
      Serial.println(f[4], HEX););
}

// ============================================================
// 🌐 SECTION: Heartbeat & Feedback Processing
// ============================================================

// 🧩 HEARTBEAT + FEEDBACK HANDLER
// ============================================================
// 📡 MAIN CONTROLLER: PACKET PROCESSING
// ============================================================
void processHeartbeatAndFeedback(uint32_t now)
{
  int packetSize = Udp.parsePacket();
  if (packetSize <= 0)
    return;

  uint8_t buf[16];
  int n = Udp.read(buf, sizeof(buf));
  if (n < 3)
    return; // Too short to be valid

  uint8_t id = 0, st = 0, cks = 0;

  // ---------------------------------------------------------
  // 1. HEARTBEAT [0xAB] - "I am alive"
  // ---------------------------------------------------------
  if (buf[0] == 0xAB && n >= 4)
  {
    id = buf[1];
    st = buf[2];
    cks = buf[3];

    if (((buf[0] ^ buf[1] ^ buf[2]) == cks) && id < NUM_STATIONS)
    {
      // Logic Preservation: Update timestamps
      lastHeartbeatMs[id] = now;
      stationOffline[id] = false;
      heartbeatCount[id]++;

      // Logic Preservation: Sync on reconnect
      if (!firstHeartbeatSeen[id])
      {
        firstHeartbeatSeen[id] = true;
        DBG(2, Serial.print(F("[SYNC] Station found: ")); Serial.println(id));
        sendFeedbackRequest(id);
      }
    }
  }

  // ---------------------------------------------------------
  // 2. FEEDBACK [0xAC] - "Here are my sensor states"
  // ---------------------------------------------------------
  else if (buf[0] == 0xAC && n >= 5)
  {
    id = buf[1];
    uint8_t bits = buf[2];
    cks = buf[4];

    if (((buf[0] ^ buf[1] ^ buf[2] ^ buf[3]) == cks) && id < NUM_STATIONS)
    {
      // Logic Preservation: Update global state
      stationFeedback[id] = bits;
      lastHeartbeatMs[id] = now;
      stationOffline[id] = false;
    }
  }

  // ---------------------------------------------------------
  // 3. CONFLICT CHECK [0xAE] - "Can I use this ID?"
  // ---------------------------------------------------------
  else if (buf[0] == 0xAE && n >= 3)
  {
    id = buf[1];
    cks = buf[2];

    if (cks == (buf[0] ^ buf[1]))
    {
      bool inUse = false;

      // STEP 1: Check internal memory first
      if (!stationOffline[id])
      {
        // STEP 2: ACTIVE PING VERIFICATION
        // The memory says it's online, but is it? Or is it a ghost?
        // We send a Feedback Request to the specific IP and wait 100ms.

        // Flush buffer first
        while (Udp.parsePacket())
          Udp.flush();

        // Send Ping
        sendFeedbackRequest(id);

        // Wait 100ms for a reply
        uint32_t tPing = millis();
        bool pingReply = false;

        while (millis() - tPing < 100)
        {
          if (Udp.parsePacket())
          {
            // We got a packet! Check if it's a valid reply from ID 'id'
            uint8_t pBuf[16];
            int pn = Udp.read(pBuf, sizeof(pBuf));
            // Check for Feedback (0xAC) or Heartbeat (0xAB) from target ID
            if (pn >= 4 && (pBuf[0] == 0xAC || pBuf[0] == 0xAB) && pBuf[1] == id)
            {
              pingReply = true;
              break;
            }
          }
        }

        // If we got a reply, it's TRULY in use.
        // If silence, it was a ghost session (the candidate itself rebooting).
        inUse = pingReply;
      }

      // STEP 3: Send Decision
      // 0xFF = Conflict, 0x00 = OK
      uint8_t status = inUse ? 0xFF : 0x00;

      uint8_t reply[3];
      reply[0] = 0xAF;
      reply[1] = id;
      reply[2] = status ^ reply[0] ^ reply[1];

      Udp.beginPacket(Udp.remoteIP(), UDP_PORT);
      Udp.write(reply, 3);
      Udp.endPacket();

      DBG(2,
          Serial.print(F("[HS] Check ID "));
          Serial.print(id);
          Serial.println(inUse ? F(" -> BLOCKED (Active Ping)") : F(" -> FREE (No Ping Reply)")););

      // If we decided it's FREE (Ghost killed), mark it offline immediately
      if (!inUse && !stationOffline[id])
      {
        stationOffline[id] = true;
      }
    }
  }
}

// 🧩 OFFLINE DETECTION
void updateHeartbeatStatus(uint32_t now)
{
  for (uint8_t id = 0; id < NUM_STATIONS; id++)
  {
    if (now - lastHeartbeatMs[id] > HEARTBEAT_TIMEOUT_MS)
    {
      stationOffline[id] = true;
      firstHeartbeatSeen[id] = false; // 🧩 Reset flag here
    }
    else
    {
      stationOffline[id] = false;
    }

    // Detect stations that just came online
    static bool wasOffline[NUM_STATIONS] = {true};
    for (uint8_t id = 0; id < NUM_STATIONS; id++)
    {
      bool nowOffline = (now - lastHeartbeatMs[id] > HEARTBEAT_TIMEOUT_MS);
      if (wasOffline[id] && !nowOffline)
      {
        // Station transitioned from OFFLINE → ONLINE
        DBG(1,
            Serial.print(F("[REQ] Requesting feedback from station "));
            Serial.println(id););
        sendFeedbackRequest(id);
      }
      wasOffline[id] = nowOffline;
    }
  }
}

// -------------------------------------------------------------------
// FUNCTION: sendFeedbackRequest()
// PURPOSE : Request one or all stations to resend feedback frames.
// -------------------------------------------------------------------
void sendFeedbackRequest(uint8_t id)
{
  uint8_t buf[5];
  buf[0] = 0xAD;
  buf[1] = id; // target ID, or 255 for broadcast
  buf[2] = 0x00;
  buf[3] = 0x00;
  buf[4] = xorChecksum(buf, 4);

  IPAddress ipStation = (id == 255)
                            ? IPAddress(192, 168, 1, 255)
                            : IPAddress(192, 168, 1, 10 + id);

  Udp.beginPacket(ipStation, UDP_PORT);
  Udp.write(buf, 5);
  Udp.endPacket();
  DBG(1,
      Serial.print(F("[REQ] Feedback request sent to "));
      Serial.println(id == 255 ? F("ALL stations") : String(id)););
}

// ============================================================
// 🧩 FUNCTION: sendAllStations()
// PURPOSE : Sends UDP "SET" frames to all enabled, online stations.
//            Dynamically packs bits based on station-specific switch ranges.
// ------------------------------------------------------------
// NOTE: Uses the global stableState[], ipSx variables, and stationEnabled[].
// ============================================================

void sendAllStations()
{
  // 🧩 Define IP table
  const IPAddress stationIPs[NUM_STATIONS] = {
      ipS0, ipS1, ipS2, ipS3, ipS4, ipS5};

  for (uint8_t st = 0; st < NUM_STATIONS; st++)
  {

    // Skip disabled/offline
    if (!stationEnabled[st] || stationOffline[st])
      continue;

    bool bits[8] = {0};
    uint8_t bitCount = 0;

    // 🧠 Collect all inputs belonging to this station
    for (uint8_t i = 0; i < INPUT_MAP_COUNT; i++)
    {
      const InputMap &m = INPUT_MAP[i];
      if (m.station == st)
      {
        bool val = stableState[m.index];

#if ENABLE_THERMOSTAT
        // Optional thermostat override block (still works)
        for (uint8_t t = 0; t < 2; t++)
        {
          if (thermostatEnabled[t] && thermostatActive[t])
          {
            for (uint8_t k = 0; k < TH_OVERRIDE_COUNT[t]; k++)
            {
              if (m.index == TH_OVERRIDE_IDX[t][k])
              {
                val = true; // forced ON
                break;
              }
            }
          }
        }
#endif

        bits[m.bit] = val;
        bitCount = max(bitCount, m.bit + 1);
      }
    }

    // ============================================================
    // 📨 Pack bits and send to station
    // ============================================================
    uint8_t packed = packBitsLSB(bits, bitCount);
    sendSetFrame(stationIPs[st], st, packed);

    DBG(3,
        Serial.print(F("[TX→ST] "));
        Serial.print(st);
        Serial.print(F(" bits="));
        Serial.println(packed, BIN););
  }
}

// ============================================================
// 🛰️  SECTION: Send Commands to Stations
// ============================================================

void sendStationCommand(uint8_t id, uint8_t bits)
{
  uint8_t buf[5];
  buf[0] = 0xAA;                              // Command header
  buf[1] = id;                                // Station ID
  buf[2] = 0x01;                              // Command: SET
  buf[3] = bits;                              // Bitfield (LSB→OUT0)
  buf[4] = buf[0] ^ buf[1] ^ buf[2] ^ buf[3]; // XOR checksum

  // Compute target IP based on station ID
  IPAddress ipStation(192, 168, 1, 10 + id);

  Udp.beginPacket(ipStation, 8888);
  Udp.write(buf, 5);
  Udp.endPacket();

  DBG(2,
      Serial.print(F("[TX→ST] ID="));
      Serial.print(id);
      Serial.print(F(" bits="));
      Serial.print(bits, BIN);
      Serial.print(F(" CKS="));
      Serial.println(buf[4], HEX););
}

// ============================================================
// 🔧 FUNCTIONS: EEPROM Handlers
// ============================================================
// -------------------------------------------------------------------
// FUNCTION: loadStationStatesFromEEPROM()
// PURPOSE : Loads station enable/disable flags from EEPROM,
//           validating data and falling back to defaults if invalid.
// -------------------------------------------------------------------
void loadStationStatesFromEEPROM()
{
  for (uint8_t i = 0; i < NUM_STATIONS; i++)
  {
    uint8_t val = EEPROM.read(i);

    if (val != 0xFF && val <= 1)
    {
      stationEnabled[i] = val;
    }
    else
    {
      stationEnabled[i] = true; // default enabled
    }
  }

#if DEBUG_SERIAL
  Serial.println(F("[EEPROM] Loaded station enable states:"));
  for (uint8_t i = 0; i < NUM_STATIONS; i++)
  {
    Serial.print(F("[EEPROM] Station "));
    Serial.print(i);
    Serial.print(F(": "));
    Serial.println(stationEnabled[i] ? F("ENABLED") : F("DISABLED"));
  }
#endif
}

void saveStationStateToEEPROM(uint8_t id)
{
  if (id < NUM_STATIONS)
  {
    EEPROM.update(id, stationEnabled[id]);
#if DEBUG_SERIAL
    Serial.print(F("[EEPROM] Saved Station "));
    Serial.print(id);
    Serial.print(F(" = "));
    Serial.println(stationEnabled[id] ? F("ENABLED") : F("DISABLED"));
#endif
  }
}

// ============================================================
// 🧩 Station Enable/Disable Long-Press Handler
// ============================================================

void handleStationEnableLongPress(uint32_t now)
{
  for (uint8_t id = 0; id < NUM_STATIONS; id++)
  {
    uint8_t idx = stationButtonIndex[id];
    bool pressed = stableState[idx]; // assuming stableState[] is debounced & true = pressed

    if (pressed && !pressActive[id])
    {
      pressActive[id] = true;
      pressStart[id] = now;
    }
    else if (!pressed && pressActive[id])
    {
      pressActive[id] = false;
    }
    else if (pressed && pressActive[id] && (now - pressStart[id] >= LONGPRESS_MS))
    {
      // ⏱️ Long-press detected → toggle state
      stationEnabled[id] = !stationEnabled[id];
      pressActive[id] = false;
      saveStationStateToEEPROM(id);

#if DEBUG_SERIAL
      Serial.print(F("[TOGGLE] Station "));
      Serial.print(id);
      Serial.print(F(" -> "));
      Serial.println(stationEnabled[id] ? F("ENABLED") : F("DISABLED"));
#endif

      // Optional: visual or audible feedback can go here (LED blink, beep, etc.)
    }
  }
}

// ============================================================
// 🌡️ THERMOSTAT LOGIC
// ============================================================

void updateThermostatStatus()
{
#if DEBUG_SERIAL
  static bool prevEnabled[2] = {false, false}; // for debug
  static bool prevActive[2] = {false, false};  // for debug
#endif

  // --- 🚫 Skip if feature disabled ---
  if (!ENABLE_THERMOSTAT)
  {
    // turn both LEDs OFF
    LED_PAIR(TH_LED_PAIR[0], LOW, LOW);
    LED_PAIR(TH_LED_PAIR[1], LOW, LOW);
    return;
  }

  // --- 🚫 Skip LED updates if Ethernet link is DOWN ---
  if (Ethernet.linkStatus() != LinkON)
  {
    // Let updateEthernetAndLEDs() control all LEDs (global RED blink)
    return;
  }

  for (uint8_t i = 0; i < 2; i++)
  {
    // Read switch: active when LOW
    thermostatEnabled[i] = stableState[TH_SWITCH_IDX[i]];

    // Read station feedback: bit LOW = thermostat ON
    bool bitLow = ((stationFeedback[TH_FEEDBACK_STATION[i]] & (1 << TH_FEEDBACK_BIT[i])) == 0);
    thermostatActive[i] = bitLow;

// -------------------------------------------------------------------
// 🧩 DETECT CHANGES AND REPORT
// -------------------------------------------------------------------
#if DEBUG_SERIAL
    if (thermostatEnabled[i] != prevEnabled[i])
    {
      Serial.println();
      Serial.println("THERMOSTAT THERMOSTAT THERMOSTAT THERMOSTAT");

      Serial.print("stableState[TH_SWITCH_IDX[");
      Serial.print(i);
      Serial.print("]: ");
      Serial.println(stableState[TH_SWITCH_IDX[i]]);

      Serial.print("thermostatEnabled[");
      Serial.print(i);
      Serial.print("]: ");
      Serial.println(thermostatEnabled[i]);

      Serial.print(F("[TH] Thermostat "));
      Serial.print(i + 1);
      Serial.print(F(" ENABLED → "));
      Serial.println(thermostatEnabled[i] ? F("ON") : F("OFF"));
      Serial.println();
      prevEnabled[i] = thermostatEnabled[i];
    }

    if (thermostatActive[i] != prevActive[i])
    {
      Serial.println();
      Serial.print("thermostatActive[");
      Serial.print(i);
      Serial.print("]: ");
      Serial.println(thermostatActive[i]);

      Serial.print(F("[TH] Thermostat "));
      Serial.print(i + 1);
      Serial.print(F(" ACTIVE → "));
      Serial.println(thermostatActive[i] ? F("ON") : F("OFF"));
      Serial.println();
      prevActive[i] = thermostatActive[i];
    }
#endif

    // -------------------------------------------------------------------
    // LED logic: RED = off, GREEN = on
    // -------------------------------------------------------------------
    if (thermostatEnabled[i])
    {
      if (thermostatActive[i])
        LED_PAIR(TH_LED_PAIR[i], LOW, HIGH); // GREEN
      else
        LED_PAIR(TH_LED_PAIR[i], HIGH, LOW); // RED
    }
    else
    {
      LED_PAIR(TH_LED_PAIR[i], LOW, LOW); // OFF
    }
  }
}

// -------------------------------------------------------------------
// FUNCTION: updateBuzzerLED()
// PURPOSE : Controls LED pair 21 and buzzer pin according to the
//           vacuum alert and buzzer enable switch.
// -------------------------------------------------------------------

void updateBuzzerLED(uint32_t now)
{
  // ============================================================
  // 1️⃣ Link Check — If link is DOWN, Ethernet code owns LEDs.
  // Also never beep while offline.
  // ============================================================
  if (Ethernet.linkStatus() != LinkON)
  {
    digitalWrite(PIN_BUZZER, LOW);
    return;
  }

  // ============================================================
  // 2️⃣ Read Operator Buzzer Switch
  // switchOn == true  -> allowed to make noise
  // switchOn == false -> muted
  // ============================================================
  bool switchOn = stableState[BUZZER_SWITCH_IDX];
  bool alert = anyVacuumAlert;

  // ============================================================
  // 3️⃣ If we have ANY vacuum alert
  // LED 21 takes alarm look. Buzzer behavior depends on mode.
  // ============================================================
  if (alert && switchOn)
  {

#if BUZZER_ALERT_MODE
    // --- Pulsed tone mode ---
    static uint32_t buzzerCycleStart = 0;
    static bool buzzerCycleOn = false;

    uint32_t elapsed = now - buzzerCycleStart;

    if (buzzerCycleOn && elapsed >= BUZZER_ALERT_ON_MS)
    {
      buzzerCycleOn = false;
      buzzerCycleStart = now;
    }
    else if (!buzzerCycleOn && elapsed >= BUZZER_ALERT_OFF_MS)
    {
      buzzerCycleOn = true;
      buzzerCycleStart = now;
    }

    // Drive buzzer + LED based on phase
    if (buzzerCycleOn)
    {
      digitalWrite(PIN_BUZZER, HIGH);
      // LED_PAIR(BUZZER_LED_PAIR, HIGH, LOW); // solid red
    }
    else
    {
      digitalWrite(PIN_BUZZER, LOW);
      LED_PAIR(BUZZER_LED_PAIR, LOW, LOW); // off between pulses
    }
#else
    // --- Continuous tone mode ---
    digitalWrite(PIN_BUZZER, HIGH);
    // LED_PAIR(BUZZER_LED_PAIR, blinkPhase ? HIGH : LOW, LOW);
#endif
    LED_PAIR(BUZZER_LED_PAIR, blinkPhase ? HIGH : LOW, LOW);
  }

  // ---------------- MUTE MODE ----------------
  else if (alert && !switchOn)
  {
    // operator muted during alarm
    digitalWrite(PIN_BUZZER, LOW);

    // LED always blinks red when in alert
    LED_PAIR(BUZZER_LED_PAIR, blinkPhase ? HIGH : LOW, LOW);
  }

  // ============================================================
  // 5️⃣ Reminder chirp (mute warning)
  //    Only applies when switchOff && no alert
  // ============================================================
#if BUZZER_REMINDER
  else if (!alert && !switchOn)
  {
    // ============================================================
    // ✅ Only allow reminder when any vacuum switch is ON
    //    and its LED pair is GREEN (vacuum OK)
    // ============================================================
    bool vacuumOK = false;

    // Station 1: vacuum switches 2, 3 → LED pairs 2, 3
    if ((stableState[2] && digitalRead(LED_B[2]) == HIGH) ||
        (stableState[3] && digitalRead(LED_B[3]) == HIGH))
      vacuumOK = true;

    // Station 2: vacuum switch 9 → LED pair 9
    if (stableState[9] && digitalRead(LED_B[9]) == HIGH)
      vacuumOK = true;

    // Station 3: vacuum switch 14 → LED pair 14
    if (stableState[14] && digitalRead(LED_B[14]) == HIGH)
      vacuumOK = true;

    // Station 4: vacuum switch 17 → LED pair 17
    if (stableState[17] && digitalRead(LED_B[17]) == HIGH)
      vacuumOK = true;

    if (!vacuumOK)
    {
      // 🚫 No active vacuum in OK state → skip reminder entirely
      LED_PAIR(BUZZER_LED_PAIR, switchOn ? LOW : HIGH, switchOn ? HIGH : LOW);
      digitalWrite(PIN_BUZZER, LOW);
      return;
    }

    // ============================================================
    // ✅ Continue with normal reminder pulse logic
    // ============================================================
    static uint32_t reminderStartMs = 0;
    static bool reminderInit = false;

    if (!reminderInit)
    {
      reminderStartMs = now;
      reminderInit = true;
    }

    uint32_t elapsed = now - reminderStartMs;
    if (elapsed >= REMINDER_PERIOD_MS)
    {
      reminderStartMs = now;
      elapsed = 0;
    }

    bool inBeepWindow = (elapsed < REMINDER_ON_MS);

    if (inBeepWindow)
    {
      // short chirp + solid RED
      LED_PAIR(BUZZER_LED_PAIR, HIGH, LOW);
      digitalWrite(PIN_BUZZER, HIGH);
    }
    else
    {
      // idle GREEN + buzzer OFF
      LED_PAIR(BUZZER_LED_PAIR, LOW, HIGH);
      digitalWrite(PIN_BUZZER, LOW);
    }

    return;
  }
#endif

  // ---------------- NO ALERT ----------------
  else
  {
    digitalWrite(PIN_BUZZER, LOW);

    // LED solid green if system armed, red if muted
    LED_PAIR(BUZZER_LED_PAIR, switchOn ? LOW : HIGH, switchOn ? HIGH : LOW);
  }
}

// --------------------------------------------------------------
// 🎰 Vegas Mode LED Test Sequence
// -------------------------------------------------------------------
// FUNCTION: runVegasMode()
// PURPOSE : Sequentially flashes all LED pairs (red/green) for
//           verification during boot. Optional cosmetic feature.
// -------------------------------------------------------------------

#if DEBUG_SERIAL
// TEMP VEGAS UNTIL FULL
void runVegasMode()
{
  if (!ENABLE_VEGAS_MODE)
    return;

  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
  {
    // digitalWrite(LED_A[i], HIGH);
    // test led 2
    digitalWrite(LED_A[2], HIGH);
    delay(VEGAS_DELAY_MS);
  }

  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
  {
    // digitalWrite(LED_B[i], HIGH);
    // test led 2
    digitalWrite(LED_B[2], HIGH);
    delay(VEGAS_DELAY_MS);
  }

  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
  {
    LED_PAIR(2, LOW, LOW);
  }
}

#else

void runVegasMode()
{
  if (!ENABLE_VEGAS_MODE)
    return;

  // Serial.println(F("[VEGAS] Starting LED diagnostic sequence..."));

  // --- 1️⃣ Sweep all RED LEDs ---
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
  {
    digitalWrite(LED_A[i], HIGH); // RED ON
    delay(VEGAS_DELAY_MS);
    digitalWrite(LED_A[i], LOW);
  }

  delay(200);

  // --- 2️⃣ Sweep all GREEN LEDs ---
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
  {
    digitalWrite(LED_B[i], HIGH); // GREEN ON
    delay(VEGAS_DELAY_MS);
    digitalWrite(LED_B[i], LOW);
  }

  delay(200);

  // --- 3️⃣ Station-by-station red/green flash ---
  uint8_t startIndex = 0;
  const uint8_t stationPairCount[NUM_STATIONS] = {2, 6, 4, 4, 3, 2}; // pairs per station

  for (uint8_t st = 0; st < NUM_STATIONS; st++)
  {
    for (uint8_t f = 0; f < VEGAS_FLASHES; f++)
    {
      for (uint8_t j = 0; j < stationPairCount[st]; j++)
      {
        uint8_t idx = startIndex + j;
        LED_PAIR(idx, HIGH, LOW);
      }
      delay(200);
      for (uint8_t j = 0; j < stationPairCount[st]; j++)
      {
        uint8_t idx = startIndex + j;
        LED_PAIR(idx, LOW, HIGH);
      }
      delay(200);
    }
    // turn off all LEDs for this station before next
    for (uint8_t j = 0; j < stationPairCount[st]; j++)
    {
      uint8_t idx = startIndex + j;
      LED_PAIR(idx, LOW, LOW);
    }
    startIndex += stationPairCount[st];
  }

  delay(200);

  // --- 4️⃣ Global RED/GREEN flashes ---
  for (uint8_t f = 0; f < VEGAS_FLASHES; f++)
  {
    // all RED
    for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
    {
      LED_PAIR(i, HIGH, LOW);
    }
    delay(300);
    // all GREEN
    for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
    {
      LED_PAIR(i, LOW, HIGH);
    }
    delay(300);
  }

  // --- turn everything off ---
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
  {
    LED_PAIR(i, LOW, LOW);
  }

  // Serial.println(F("[VEGAS] LED test complete."));
}
#endif

// ----------------------------- SETUP ----------------------------------
// ============================================================================
// FUNCTION: setup()
// PURPOSE : Initializes hardware, network, EEPROM, MCP23017 expanders,
//           I/O directions, and LED diagnostics (Vegas mode).
// NOTES   : Called once at startup before main loop.
// ============================================================================
void setup()
{
  // 1. Disable WDT immediately (Mega can get stuck in WDT loops at boot)
  wdt_disable();

  // 2. Power Stabilization (Give the W5500 time to power up)
  delay(1000);

#if DEBUG_SERIAL
  Serial.begin(115200);
  while (!Serial)
  {
  }
  Serial.println();
  Serial.println(F("================================================"));
  Serial.println(F(" Main Controller Firmware - STABLE BOOT FIX"));
  Serial.print(F(" Version: "));
  Serial.println(FIRMWARE_VERSION);
  Serial.println(F("================================================"));
  Serial.println(F("[BOOT] Main_Controller_Binary_Detailed starting..."));
#endif

  // 3. Setup Output Pins for LED/Buzzer early (safe state)
  // ✅ Buzzer output
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  // --- LED setup
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
  {
    pinMode(LED_A[i], OUTPUT);
    pinMode(LED_B[i], OUTPUT);
    LED_PAIR(i, LOW, LOW);
  }

  // 4. Initialize Ethernet (Blocking until success)
  initEthernet();

  // 5. Initialize MCP23017
  // We do this AFTER Ethernet to ensure SPI bus traffic has settled
  // ✅ Initialize MCP23017 I/O expander
  mcp.begin_I2C(MCP_I2C_ADDR);

  // Configure MCP Inputs
  // ✅ Configure all 16 pins as INPUT_PULLUP
  for (uint8_t p = 0; p < 8; p++)
  {
    mcp.pinMode(p, INPUT_PULLUP);
    mcp.pinMode(p + 8, INPUT_PULLUP);
  }
  mcp.setupInterrupts(false, false, LOW);
  for (uint8_t p = 0; p < 16; p++)
  {
    mcp.setupInterruptPin(p, CHANGE);
  }
  pinMode(MCP_INTA_PIN, INPUT_PULLUP);
  pinMode(MCP_INTB_PIN, INPUT_PULLUP);

  // 6. Initialize State Arrays
  // ✅ Initial snapshot of MCP ports (initialize stableState)
  mcpStateA = mcp.readGPIO(0);
  mcpStateB = mcp.readGPIO(1);

  // ✅ Attach interrupts
  attachInterrupt(digitalPinToInterrupt(MCP_INTA_PIN), []()
                  { mcpIntA_Flag = true; }, FALLING);
  attachInterrupt(digitalPinToInterrupt(MCP_INTB_PIN), []()
                  { mcpIntB_Flag = true; }, FALLING);

  // Read Physical Inputs
  for (uint8_t i = 0; i < NUM_INPUTS; i++)
  {
    pinMode(PHYS_SW_PINS[i], INPUT_PULLUP);
    stableState[i] = !digitalRead(PHYS_SW_PINS[i]);
  }

  // Read MCP Inputs
  for (uint8_t b = 0; b < 8; b++)
  {
    stableState[NUM_INPUTS + b] = ((mcpStateA & (1 << b)) == 0);
    stableState[NUM_INPUTS + 8 + b] = ((mcpStateB & (1 << b)) == 0);
  }

  // 7. Vegas Mode
  if (ENABLE_VEGAS_MODE)
  {
    runVegasMode();
  }

  // 8. EEPROM Load
  loadStationStatesFromEEPROM();

  // 9. Enable Watchdog (Only now that we are safe)
  wdt_enable(WDTO_8S);

#if DEBUG_SERIAL
  Serial.println(F("[INIT] Setup complete. Entering Loop."));
#endif
}

//   // 2. SPI Safety Configuration
//   // --- Ethernet setup
//   // Before doing anything, ensure the Mega's Hardware SS is OUTPUT HIGH
//   // and the Ethernet CS is OUTPUT HIGH (Deselected).
//   pinMode(53, OUTPUT); // Mega Hardware SS
//   digitalWrite(53, HIGH);

//   pinMode(ETH_CS, OUTPUT); // W5500 CS
//   digitalWrite(ETH_CS, HIGH);

//   pinMode(ETH_RESET, OUTPUT);
//   // Ensure reset pin starts High before the pulse function toggles it
//   digitalWrite(ETH_RESET, HIGH);

//   // ✅ Configure all 16 pins as INPUT_PULLUP
//   for (uint8_t p = 0; p < 8; p++)
//   {
//     mcp.pinMode(p, INPUT_PULLUP);     // GPA0-7
//     mcp.pinMode(p + 8, INPUT_PULLUP); // GPB0-7
//   }

//   // ✅ Configure interrupts (so mcpIntA_Flag / mcpIntB_Flag get triggered)
//   mcp.setupInterrupts(false, false, LOW);
//   for (uint8_t p = 0; p < 16; p++)
//   {
//     mcp.setupInterruptPin(p, CHANGE);
//   }

//   // ✅ Setup interrupt input pins on Arduino
//   pinMode(MCP_INTA_PIN, INPUT_PULLUP);
//   pinMode(MCP_INTB_PIN, INPUT_PULLUP);

//   // ---------- stableState ----------
//   // ✅ Add to stableState - Physical switch inputs (direct pins)
//   for (uint8_t i = 0; i < NUM_INPUTS; i++)
//   {
//     pinMode(PHYS_SW_PINS[i], INPUT_PULLUP);
//     stableState[i] = !digitalRead(PHYS_SW_PINS[i]); // active-low
//   }

//   // ✅ Add to stableState - MCP switch inputs
//   for (uint8_t b = 0; b < 8; b++)
//   {
//     stableState[NUM_INPUTS + b] = ((mcpStateA & (1 << b)) == 0);
//     stableState[NUM_INPUTS + 8 + b] = ((mcpStateB & (1 << b)) == 0);
//   }

//   // ✅ LED Outputs
//   for (uint8_t k = 0; k < NUM_LED_PAIRS; k++)
//   {
//     pinMode(LED_A[k], OUTPUT);
//     pinMode(LED_B[k], OUTPUT);
//     LED_PAIR(k, LOW, HIGH); // initialize GREEN
//   }

//   // ✅ Vegas LED Diagnostic (keep)
//   if (ENABLE_VEGAS_MODE)
//   {
//     uint32_t t0 = millis();
//     runVegasMode();
//     uint32_t elapsed = millis() - t0;
// #if DEBUG_SERIAL
//     Serial.print(F("[VEGAS] Duration: "));
//     Serial.print(elapsed);
//     Serial.println(F(" ms"));
//     Serial.println(F("------------------------------------------------"));
// #endif
//   }

//   // ✅ EEPROM Load
//   loadStationStatesFromEEPROM(); // restore last enable/disable states

//   // ✅ Enable watchdog timer (keep it)
//   wdt_enable(WDTO_8S); // Enable only after setup() fully completes

//   // TEMP TEMP TEMP TEMP TEMP TEMP
//   Serial.println(F("[DEBUG] Initial pin voltages:"));
//   for (uint8_t i = 0; i < NUM_INPUTS; i++)
//   {
//     Serial.print(F("Pin "));
//     Serial.print(PHYS_SW_PINS[i]);
//     Serial.print(F(" = "));
//     Serial.println(digitalRead(PHYS_SW_PINS[i]));
//   }
//   // END TEMP TEMP TEMP TEMP TEMP TEMP

// #if DEBUG_SERIAL
//   Serial.println(F("[INIT] Setup complete."));
// #endif

//   // Enable Watchdog at the VERY END of setup
//   wdt_enable(WDTO_8S);
// }

// ----------------------------- LOOP -----------------------------------
// ============================================================================
// FUNCTION: loop()
// PURPOSE : Executes the main runtime cycle:
//           - Reads all inputs and MCP23017 ports
//           - Handles long-press toggles
//           - Updates LED states and Ethernet link indicators
//           - Processes feedback/heartbeat packets
//           - Executes thermostat and buzzer logic
//           - Sends periodic status frames to each station.
// ============================================================================
void loop()
{
  wdt_reset(); // Keep it alive every loop iteration
  uint32_t now = millis();

  // ============================================================
  // 🔁 MCP23017 Read (update snapshot before processing inputs)
  // ============================================================
  if (mcpIntA_Flag)
    readMcpA();
  if (mcpIntB_Flag)
    readMcpB();

  // ============================================================
  // 🔁 Unified Input Read + Debounce Loop
  // ============================================================

  for (uint8_t i = 0; i < INPUT_MAP_COUNT; i++)
  {
    const InputMap &m = INPUT_MAP[i];
    bool current = readInputByMap(m);

    if (current != rawState[m.index])
    {
      rawState[m.index] = current;
      lastChange[m.index] = now;
    }

    if ((now - lastChange[m.index]) > DEBOUNCE_MS)
    {
      stableState[m.index] = rawState[m.index];
    }
  }

#if DEBUG_SERIAL
  // 🧩 4️⃣ (Optional) Debug print — place here 👇
  static uint32_t lastPrint = 0;
  if (now - lastPrint >= 1000)
  {
    lastPrint = now;
    Serial.print(F("[INPUT] stableState: "));
    for (uint8_t i = 0; i < INPUT_MAP_COUNT; i++)
      Serial.print(stableState[i]);
    Serial.println();
  }
#endif

  // 🔁 Blink-phase update (global for all blinking states)
  if (now - tBlink >= BLINK_INTERVAL_MS)
  {
    tBlink = now;
    blinkPhase = !blinkPhase;
  }

  DBG(2,
      // IPAddress rip = Udp.remoteIP();
      // Serial.print(F("[RX] size="));
      // Serial.print(pkt);
      // Serial.print(F(" from "));
      // Serial.println(rip);

      // Simple diagnostic printout
      uint8_t mcpA = mcp.readGPIO(0);
      uint8_t mcpB = mcp.readGPIO(1);
      Serial.print(F("MCP A: "));
      Serial.print(mcpA, BIN);
      Serial.print(F("  MCP B: "));
      Serial.println(mcpB, BIN););

  // 2️⃣ Process incoming packets
  processHeartbeatAndFeedback(now);

  // 3️⃣ Update station online/offline
  updateHeartbeatStatus(now);

  // Long press for station enable / disable
  handleStationEnableLongPress(now);

  // 4️⃣ Update LEDs + Ethernet status
  updateEthernetAndLEDs(now); // sets anyVacuumAlert + regular LEDs

  // Buzzer
  updateBuzzerLED(now); // overrides LED 21 + drives buzzer

  // Thermostat
  updateThermostatStatus(); // (this already bails when link down)

  // --------------------------------------------------
  // 5️⃣ SEND COMMAND FRAMES TO STATIONS
  // --------------------------------------------------
  if (now - tSend >= SEND_INTERVAL_MS)
  {
    tSend = now;
    sendAllStations(); // ⬅️ this wraps your sendSetFrame() logic
  }

  // // --------------------------------------------------
  // // 6️⃣ HANDLE BUZZER + VACUUM LOGIC
  // // --------------------------------------------------
  // updateBuzzer(now);

  // // --------------------------------------------------
  // // 7️⃣ OPTIONAL DEBUG STATS
  // // --------------------------------------------------
  // if (DEBUG_SERIAL && now - lastHeartbeatPrint >= 5000)
  // {
  //   lastHeartbeatPrint = now;
  //   Serial.print(F("[HB] Counts: "));
  //   for (uint8_t i = 0; i < NUM_STATIONS; i++)
  //   {
  //     Serial.print(heartbeatCount[i]);
  //     Serial.print(' ');
  //   }
  //   Serial.println();
  // }

  DBG(3,
      EthernetLinkStatus st = Ethernet.linkStatus();
      Serial.print(F("[DEBUG] LinkStatus = "));
      Serial.println(st););

} // ✅ end loop()