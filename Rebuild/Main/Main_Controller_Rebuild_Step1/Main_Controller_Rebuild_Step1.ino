/*
  ==============================================================
  MAIN CONTROLLER — BASELINE REBUILD STEP 1
  Hardware-level initialization + MCP/LED/Vegas diagnostic only
  ==============================================================
*/

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
#define DEBUG_SERIAL true // for the else clauses

// Limit how often serial debug lines are printed
// ---------------- DEBUG CONFIG ----------------
#define DEBUG_LEVEL 3                                   // 0 = Off, 1 = Errors only, 2 = Normal, 3 = Verbose
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

// -------------------- SYSTEM DEFINES --------------------
#define DEBUG_SERIAL true
#define FIRMWARE_VERSION "v1.0-RebuildStep1"
#define ENABLE_VEGAS_MODE 1 // Set false to skip startup LED test

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

// -------------------- BUZZER --------------------
#define PIN_BUZZER 2
#define LEDPAIR_BUZZER 21
#define BUZZER_QUEUE_SIZE 8
#define BUZZER_BLINK_MS 150 // blink period during active alarm

// -------------------- INPUT / OUTPUT COUNTS --------------------
#define NUM_STATIONS 6
#define NUM_INPUTS 8 // only the physical ones read directly
#define NUM_LED_PAIRS 24
#define TOTAL_INPUTS (NUM_INPUTS + 16) // 8 physical + 16 MCP

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

// Map each LED pair index (0–23) to its owning station
//  - Last pairs (21–23) are reserved (buzzer, thermostats, etc.)
const uint8_t LED_OWNER[NUM_LED_PAIRS] = {
    ST0, ST0,                     // 0–1  Station 0
    ST1, ST1, ST1, ST1, ST1, ST1, // 2–7  Station 1
    ST2, ST2, ST2, ST2,           // 8–11 Station 2
    ST3, ST3, ST3, ST3,           // 12–15 Station 3
    ST4, ST4, ST4,                // 16–18 Station 4
    ST5, ST5,                     // 19–20 Station 5
    255, 255, 255                 // 21–23 reserved / non-station LEDs
};

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

#define VEGAS_DELAY_MS 60  // Speed between LEDs (adjust to taste)
#define VEGAS_FLASHES = 3; // Number of red/green blinks per station

// -------------------- EEPROM Address --------------------
#define EEPROM_STATION_BASE 0 // start address

// ============================================================
// 🧩 STATION ENABLE/DISABLE MANAGEMENT
// ============================================================

const uint32_t LONGPRESS_MS = 5000; // Hold 5s to toggle enable

bool stationEnabled[NUM_STATIONS] = {true};
bool stationOffline[NUM_STATIONS] = {false};
uint8_t stationFeedback[NUM_STATIONS] = {0};

// For long-press detection
bool pressActive[NUM_STATIONS] = {false};
uint32_t pressStart[NUM_STATIONS] = {0};

// Map each station to the input index in stableState[]
const uint8_t stationButtonIndex[NUM_STATIONS] = {
    2,  // Station 0 → first input
    3,  // Station 1 → second input
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
const uint8_t TH_FEEDBACK_BIT[2] = {0, 3};     // Bit positions in stationFeedback[station]

// Override switch indices (multiple allowed)
const uint8_t TH1_OVERRIDE_IDX[] = {0, 9, 14}; // Thermostat 1
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
uint8_t stableState[TOTAL_INPUTS] = {0}; // logical debounced values

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
uint8_t buzzerQueue[BUZZER_QUEUE_SIZE];
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
// ------------------------ BUZZER RHYTHM LOGIC ------------------------
struct BeepPattern
{
  uint8_t count;    // number of beeps
  uint16_t baseDur; // base duration of one beep
};

// ----------------------------- VACUUM ALERT MAPPING -----------------------------
struct VacuumMap
{
  uint8_t switchIndex[2]; // up to 2 switches per station
  uint8_t ledPair[2];     // up to 2 LED pairs per station
  uint8_t stationID;      // source station for feedback
  uint8_t bitIndex[2];    // which bits in stationFeedback[] correspond
};

// ============================================================
// 🚨 SECTION: Buzzer System Core
// ============================================================

// ------------------------ BeepPattern table ------------------------
const BeepPattern STATION_BEEP[4] = {
    {1, 600}, // Station 1 (1 long beep)
    {2, 200}, // Station 2 (2 semi-long)
    {3, 120}, // Station 3 (3 short)
    {4, 85}   // Station 4 (5 short, roughly x/7 base)
};

// ------------------------ BUZZER QUEUE SYSTEM ------------------------
bool buzzerQueueEmpty() { return buzzerHead == buzzerTail; }
bool buzzerQueueFull() { return ((buzzerTail + 1) % BUZZER_QUEUE_SIZE) == buzzerHead; }

void buzzerQueuePush(uint8_t st)
{
  if (!buzzerQueueFull())
  {
    buzzerQueue[buzzerTail] = st;
    buzzerTail = (buzzerTail + 1) % BUZZER_QUEUE_SIZE;
  }
}

uint8_t buzzerQueuePop()
{
  uint8_t st = buzzerQueue[buzzerHead];
  buzzerHead = (buzzerHead + 1) % BUZZER_QUEUE_SIZE;
  return st;
}

// -------------------------------------------------------------------
// FUNCTION: updateBuzzer()
// PURPOSE : Handles buzzer queue processing and LED synchronization.
//           Plays per-station alarm patterns and manages blinking phase.
// -------------------------------------------------------------------
// ************************************************************************************************************************
// void updateBuzzer(uint32_t now)
// {
//   // --- Read Buzzer Enable Switch (active high logic) ---
//   bool buzzerSwitch = stableState[IDX_BUZZER_EN];
//   if (!buzzerSwitch)
//   {
//     // Switch OFF → silence and clear queue
//     digitalWrite(PIN_BUZZER, LOW);
//     LED_PAIR(LEDPAIR_BUZZER, LOW, HIGH);
//     for (uint8_t s = 0; s < NUM_STATIONS; s++)
//       lastQueuedMs[s] = 0;
//     buzzerActive = false;
//     buzzerHead = buzzerTail = 0; // clear queue
//     return;
//   }

//   // --- If no active pattern, pop next queued station ---
//   if (!buzzerActive && !buzzerQueueEmpty())
//   {
//     if (currentPattern >= 4)
//     {
//       buzzerActive = false;
//       return;
//     }
//     currentPattern = buzzerQueuePop() - 1; // Station 1–4 → index 0–3
//     buzzerActive = true;
//     beepStep = 0;
//     buzzerOn = false;
//     beepTimer = now;
//   }

//   if (buzzerActive)
//   {
//     const BeepPattern &p = STATION_BEEP[currentPattern];
//     uint16_t dur = p.baseDur;

//     if (buzzerOn)
//     {
//       // currently ON: time to stop?
//       if (now - beepTimer >= dur)
//       {
//         digitalWrite(PIN_BUZZER, LOW);
//         LED_PAIR(LEDPAIR_BUZZER, LOW, LOW);
//         buzzerOn = false;
//         beepTimer = now;
//         beepStep++;
//       }
//     }
//     else
//     {
//       // currently OFF
//       if (beepStep < p.count * 2 - 1 && (now - beepTimer >= dur))
//       {
//         // start next beep
//         digitalWrite(PIN_BUZZER, HIGH);
//         LED_PAIR(LEDPAIR_BUZZER, HIGH, LOW);
//         buzzerOn = true;
//         beepTimer = now;
//       }
//       else if (beepStep >= p.count * 2 - 1)
//       {
//         // finished this pattern
//         digitalWrite(PIN_BUZZER, LOW);
//         LED_PAIR(LEDPAIR_BUZZER, LOW, HIGH);
//         buzzerActive = false;
//         beepTimer = now + 400; // 400 ms pause before next queued pattern
//       }
//     }
//   }
//   else
//   {
//     // idle: steady green
//     LED_PAIR(LEDPAIR_BUZZER, LOW, HIGH);
//   }

//   // --- Update global blink phase every BUZZER_BLINK_MS ---
//   if (buzzerActive && (now - lastBuzzerBlinkMs >= BUZZER_BLINK_MS))
//   {
//     lastBuzzerBlinkMs = now;
//     buzzerBlinkPhase = !buzzerBlinkPhase;
//   }
// }

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
//
// Handles visual indication of network link status and
// per-station feedback on the LED pairs.
// Called once per loop(), non-blocking.
//
void updateEthernetAndLEDs(uint32_t now)
{

  static bool linkDown = false;

  // --- 1️⃣ Periodically check Ethernet link ---
  if (now - lastLinkCheck >= 250)
  {
    lastLinkCheck = now;
    linkDown = (Ethernet.linkStatus() != LinkON);

    DBG(4,
        Serial.print(F("[LINK] "));
        Serial.println(linkDown ? F("DOWN") : F("OK")));
  }

  // --- 2️⃣ LINK DOWN: flash all RED LEDs together ---
  if (linkDown)
  {
    digitalWriteAll(LED_B, NUM_LED_PAIRS, LOW);        // greens off
    digitalWriteAll(LED_A, NUM_LED_PAIRS, blinkPhase); // reds blink
    return;                                            // Skip per-station logic while link is down
  }

  // --- 3️⃣ LINK UP: per-station LED behavior ---
  for (uint8_t pair = 0; pair < NUM_LED_PAIRS; pair++)
  {
    uint8_t owner = LED_OWNER[pair];
    if (owner >= NUM_STATIONS)
      continue; // Skip reserved LEDs

    // Station disabled → both LEDs OFF
    if (!stationEnabled[owner])
    {
      LED_PAIR(pair, LOW, LOW);
      continue;
    }

    // Station offline → alternate blink RED/GREEN
    if (stationOffline[owner])
    {
      LED_PAIR(pair,
               blinkPhase ? HIGH : LOW,
               blinkPhase ? LOW : HIGH);
      continue;
    }

    // --- 4️⃣ ONLINE → use station feedback bits ---
    uint8_t bitIndex;
    switch (owner)
    {
    case ST0:
      bitIndex = pair;
      break;
    case ST1:
      bitIndex = pair - 2;
      break;
    case ST2:
      bitIndex = pair - 8;
      break;
    case ST3:
      bitIndex = pair - 12;
      break;
    case ST4:
      bitIndex = pair - 16;
      break;
    case ST5:
      bitIndex = pair - 19;
      break;
    default:
      bitIndex = 0;
      break;
    }

    bool relayOn = (stationFeedback[owner] >> bitIndex) & 1;
    LED_PAIR(pair,
             relayOn ? HIGH : LOW,  // RED if relay off
             relayOn ? LOW : HIGH); // GREEN if relay on
  }
}

// -------------------------------------------------------------------
// FUNCTION: ethernetResetPulse() / initEthernet()
// PURPOSE : Performs controlled hardware reset of W5500 module,
//           initializes Ethernet interface, and retries if no link.
// -------------------------------------------------------------------
void ethernetResetPulse()
{
  pinMode(ETH_RESET, OUTPUT);
  digitalWrite(ETH_RESET, LOW);
  delay(10);
  digitalWrite(ETH_RESET, HIGH);
  delay(100);
}

void initEthernet()
{
  Ethernet.init(ETH_CS);
  ethernetResetPulse();
  Ethernet.begin(mac, ipMain);
  Udp.begin(UDP_PORT);
  Ethernet.setRetransmissionCount(1);
  Ethernet.setRetransmissionTimeout(200);

  delay(500); // Give W5500 time to settle

  EthernetLinkStatus linkStatus = Ethernet.linkStatus();
  if (linkStatus != LinkON)
  {
#if DEBUG_SERIAL
    Serial.println(F("[NET] Link not detected, retrying init..."));
    Serial.println(Ethernet.localIP());
#endif
    delay(1000);
    ethernetResetPulse();
    Ethernet.begin(mac, ipMain);
    Udp.begin(UDP_PORT);
    delay(500);
    linkStatus = Ethernet.linkStatus();
  }

#if DEBUG_SERIAL
  if (linkStatus == LinkON)
    Serial.println(F("[NET] Ethernet link OK"));
  else
    Serial.println(F("[NET] Link still down after retry"));
#endif
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
void processHeartbeatAndFeedback(uint32_t now)
{
  int packetSize = Udp.parsePacket();
  if (packetSize <= 0)
    return;

  uint8_t buf[16];
  int n = Udp.read(buf, sizeof(buf));
  if (n < 4)
    return;

  uint8_t id = 0, bits = 0, cks = 0, st = 0;

  // 🩺 HEARTBEAT FRAME [0xAB, id, status, cks]
  if (buf[0] == 0xAB && n >= 4)
  {
    id = buf[1];
    st = buf[2];
    cks = buf[3];
    if (((buf[0] ^ buf[1] ^ buf[2]) == cks) && id < NUM_STATIONS && st == 0x00)
    {
      lastHeartbeatMs[id] = now;
      stationOffline[id] = false;
      heartbeatCount[id]++;

      DBG(3,
          Serial.print(F("[HB ] Station "));
          Serial.print(id);
          Serial.println(F(" OK")););
    }
    else
    {
      DBG(2, Serial.println(F("[HB ] Invalid heartbeat")););
    }
  }

  // 💬 FEEDBACK FRAME [0xAC, id, bits, status, cks]
  else if (buf[0] == 0xAC && n >= 5)
  {
    id = buf[1];
    bits = buf[2];
    cks = buf[4];
    if (((buf[0] ^ buf[1] ^ buf[2] ^ buf[3]) == cks) && id < NUM_STATIONS)
    {
      stationFeedback[id] = bits;
      lastHeartbeatMs[id] = now;
      stationOffline[id] = false;

      DBG(3,
          Serial.print(F("[FB ] Station "));
          Serial.print(id);
          Serial.print(F(" bits="));
          Serial.println(bits, BIN););
    }
    else
    {
      DBG(2, Serial.println(F("[FB ] Invalid feedback")););
    }
  }

  // 🧠 Optional print every 5s
  DBG(4, if (DEBUG_SERIAL && now - lastHeartbeatPrint >= 5000) {
      lastHeartbeatPrint = now;
      Serial.print(F("[HB] Counts: "));
      for (uint8_t i = 0; i < NUM_STATIONS; i++)
      {
        Serial.print(heartbeatCount[i]);
        Serial.print(' ');
      }
      Serial.println(); });
}

// 🧩 OFFLINE DETECTION
void updateHeartbeatStatus(uint32_t now)
{
  for (uint8_t id = 0; id < NUM_STATIONS; id++)
  {
    if (now - lastHeartbeatMs[id] > HEARTBEAT_TIMEOUT_MS)
    {
      stationOffline[id] = true;
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
        Serial.print(F("[REQ] Requesting feedback from station "));
        Serial.println(id);
        sendFeedbackRequest(id);
      }
      wasOffline[id] = nowOffline;
    }
  }
}

// Request feedback status from station when a station gets detected.
void sendFeedbackRequest(uint8_t id)
{
  uint8_t buf[5];
  buf[0] = 0xAD; // new "Request Feedback" frame
  buf[1] = id;
  buf[2] = 0x00;
  buf[3] = 0x00;
  buf[4] = xorChecksum(buf, 4);

  IPAddress ipStation(192, 168, 1, 10 + id);
  Udp.beginPacket(ipStation, UDP_PORT);
  Udp.write(buf, 5);
  Udp.endPacket();
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
  struct StationConfig
  {
    uint8_t id;        // Station number (0–5)
    uint8_t startIdx;  // Index in stableState[] where its switches begin
    uint8_t numInputs; // How many switches it reads
    IPAddress ip;      // Station IP
  };

  // ---------------- Station mapping table ----------------
  const StationConfig stations[NUM_STATIONS] = {
      {0, 0, 2, ipS0},  // Station 0: indices 0–1
      {1, 2, 6, ipS1},  // Station 1: indices 2–7
      {2, 8, 4, ipS2},  // Station 2: indices 8–11
      {3, 12, 4, ipS3}, // Station 3: indices 12–15
      {4, 16, 3, ipS4}, // Station 4: indices 16–18
      {5, 19, 2, ipS5}  // Station 5: indices 19–20
  };

  // ---------------- Iterate over all stations -------------
  for (uint8_t i = 0; i < NUM_STATIONS; i++)
  {
    const StationConfig &st = stations[i];

    // Skip disabled or offline stations
    if (!stationEnabled[st.id] || stationOffline[st.id])
      continue;

    bool stateBits[8] = {0};

    // ============================================================
    // 🧩 Per-switch scan and thermostat override logic
    // ============================================================
    for (uint8_t j = 0; j < st.numInputs; j++)
    {
      uint8_t idx = st.startIdx + j; // Map local index → global input index
      bool val = stableState[idx];   // Current state from stableState[]

      // 🌡️ Thermostat override block
      for (uint8_t t = 0; t < 2; t++)
      {
        if (ENABLE_THERMOSTAT && thermostatEnabled[t] && thermostatActive[t])
        {
          for (uint8_t k = 0; k < TH_OVERRIDE_COUNT[t]; k++)
          {
            if (idx == TH_OVERRIDE_IDX[t][k])
            {
              val = true; // forced ON (LOW) -> Inverted
              break;
            }
          }
        }
      }

      stateBits[j] = val; // Save the final (possibly overridden) state
    }

    // ============================================================
    // 📨 Pack bits and send to station
    // ============================================================
    uint8_t packedBits = packBitsLSB(stateBits, st.numInputs);

    // TEMP DEBUG
    DBG(4,
        Serial.print(F("[DBG-IN] Station "));
        Serial.print(st.id);
        Serial.print(F(" raw bits: "));
        for (uint8_t j = 0; j < st.numInputs; j++)
            Serial.print(stateBits[j]);
        Serial.println(););
    // TEMP DEBUG - END

    sendSetFrame(st.ip, st.id, packedBits);

    DBG(3,
        Serial.print(F("[TX] Sent → Station "));
        Serial.print(st.id);
        Serial.print(F(" bits="));
        Serial.println(packedBits, BIN););
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
// void setStationEnabled(uint8_t station, bool enabled)
// {
//   if (station >= NUM_STATIONS)
//     return;

//   if (stationEnabled[station] != enabled)
//   {
//     stationEnabled[station] = enabled;
//     // write only when state changes (wear-protected)
//     EEPROM.update(EEPROM_STATION_BASE + station, enabled ? 1 : 0);
//   }

// #if DEBUG_SERIAL
//   Serial.print(F("[EEPROM] Updated Station "));
//   Serial.print(station);
//   Serial.print(F(" -> "));
//   Serial.println(enabled ? F("ENABLED") : F("DISABLED"));
// #endif
// }

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

  if (!ENABLE_THERMOSTAT)
  {
    // turn both LEDs OFF
    LED_PAIR(TH_LED_PAIR[0], LOW, LOW);
    LED_PAIR(TH_LED_PAIR[1], LOW, LOW);
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

// --------------------------------------------------------------
// 🎰 Vegas Mode LED Test Sequence
// -------------------------------------------------------------------
// FUNCTION: runVegasMode()
// PURPOSE : Sequentially flashes all LED pairs (red/green) for
//           verification during boot. Optional cosmetic feature.
// -------------------------------------------------------------------

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

// void runVegasMode()
// {
//   if (!ENABLE_VEGAS_MODE)
//     return;

// #if DEBUG_SERIAL
//   Serial.println(F("[VEGAS] Starting LED diagnostic sequence..."));
// #endif

//   // --- 1️⃣ Sweep all RED LEDs ---
//   for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
//   {
//     digitalWrite(LED_A[i], HIGH); // RED ON
//     delay(VEGAS_DELAY_MS);
//     digitalWrite(LED_A[i], LOW);
//   }

//   delay(200);

//   // --- 2️⃣ Sweep all GREEN LEDs ---
//   for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
//   {
//     digitalWrite(LED_B[i], HIGH); // GREEN ON
//     delay(VEGAS_DELAY_MS);
//     digitalWrite(LED_B[i], LOW);
//   }

//   delay(200);

//   // --- 3️⃣ Station-by-station red/green flash ---
//   uint8_t startIndex = 0;
//   const uint8_t stationPairCount[NUM_STATIONS] = {2, 6, 4, 4, 3, 2}; // pairs per station

//   for (uint8_t st = 0; st < NUM_STATIONS; st++)
//   {
//     for (uint8_t f = 0; f < VEGAS_FLASHES; f++)
//     {
//       for (uint8_t j = 0; j < stationPairCount[st]; j++)
//       {
//         uint8_t idx = startIndex + j;
//         LED_PAIR(idx, HIGH, LOW);
//       }
//       delay(200);
//       for (uint8_t j = 0; j < stationPairCount[st]; j++)
//       {
//         uint8_t idx = startIndex + j;
//         LED_PAIR(idx, LOW, HIGH);
//       }
//       delay(200);
//     }
//     // turn off all LEDs for this station before next
//     for (uint8_t j = 0; j < stationPairCount[st]; j++)
//     {
//       uint8_t idx = startIndex + j;
//       LED_PAIR(idx, LOW, LOW);
//     }
//     startIndex += stationPairCount[st];
//   }

//   delay(200);

//   // --- 4️⃣ Global RED/GREEN flashes ---
//   for (uint8_t f = 0; f < VEGAS_FLASHES; f++)
//   {
//     // all RED
//     for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
//     {
//       LED_PAIR(i, HIGH, LOW);
//     }
//     delay(300);
//     // all GREEN
//     for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
//     {
//       LED_PAIR(i, LOW, HIGH);
//     }
//     delay(300);
//   }

//   // --- turn everything off ---
//   for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
//   {
//     LED_PAIR(i, LOW, LOW);
//   }

// #if DEBUG_SERIAL
//   Serial.println(F("[VEGAS] LED test complete."));
// #endif
// }

// ----------------------------- SETUP ----------------------------------
// ============================================================================
// FUNCTION: setup()
// PURPOSE : Initializes hardware, network, EEPROM, MCP23017 expanders,
//           I/O directions, and LED diagnostics (Vegas mode).
// NOTES   : Called once at startup before main loop.
// ============================================================================
void setup()
{
#if DEBUG_SERIAL
  Serial.begin(115200);
  while (!Serial)
  {
  }
  Serial.println();
  Serial.println(F("================================================"));
  Serial.println(F(" Main Controller Firmware"));
  Serial.print(F(" Version: "));
  Serial.println(FIRMWARE_VERSION);
  Serial.println(F("================================================"));
  Serial.println(F("[BOOT] Main_Controller_Binary_Detailed starting..."));
#endif

  // ✅ Disable watchdog timer for setup
  // wdt_enable(WDTO_8S);
  wdt_disable(); // Always disable first at boot — critical on Mega
  delay(10);     // Give it a moment

  // --- Ethernet setup
  pinMode(53, OUTPUT);
  digitalWrite(53, HIGH);
  initEthernet();

  // --- LED setup
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
  {
    pinMode(LED_A[i], OUTPUT);
    pinMode(LED_B[i], OUTPUT);
    LED_PAIR(i, LOW, LOW);
  }

  // ✅ Initialize MCP23017 I/O expander
  mcp.begin_I2C(MCP_I2C_ADDR);
  for (uint8_t p = 0; p < 8; p++)
  {
    mcp.pinMode(p, INPUT_PULLUP);     // GPA0-7
    mcp.pinMode(p + 8, INPUT_PULLUP); // GPB0-7
  }

  mcp.setupInterrupts(false, false, LOW);
  for (uint8_t p = 0; p < 16; p++)
  {
    mcp.setupInterruptPin(p, CHANGE);
  }

  pinMode(MCP_INTA_PIN, INPUT_PULLUP);
  pinMode(MCP_INTB_PIN, INPUT_PULLUP);

  // ✅ Initial snapshot of MCP ports (initialize stableState)
  mcpStateA = mcp.readGPIO(0);
  mcpStateB = mcp.readGPIO(1);
  for (uint8_t b = 0; b < 8; b++)
  {
    stableState[8 + b] = ((mcpStateA & (1 << b)) == 0);
    stableState[16 + b] = ((mcpStateB & (1 << b)) == 0);
  }

  // ✅ Attach interrupts
  attachInterrupt(digitalPinToInterrupt(MCP_INTA_PIN), []()
                  { mcpIntA_Flag = true; }, FALLING);
  attachInterrupt(digitalPinToInterrupt(MCP_INTB_PIN), []()
                  { mcpIntB_Flag = true; }, FALLING);

  // ✅ Physical switch inputs (direct pins)
  for (uint8_t i = 0; i < NUM_INPUTS; i++)
  {
    pinMode(PHYS_SW_PINS[i], INPUT_PULLUP);
    stableState[i] = !digitalRead(PHYS_SW_PINS[i]); // active-low
  }

  // ✅ LED Outputs
  for (uint8_t k = 0; k < NUM_LED_PAIRS; k++)
  {
    pinMode(LED_A[k], OUTPUT);
    pinMode(LED_B[k], OUTPUT);
    LED_PAIR(k, LOW, HIGH); // initialize GREEN
  }

  // ✅ Buzzer output
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  // ✅ Vegas LED Diagnostic (keep)
  if (ENABLE_VEGAS_MODE)
  {
    uint32_t t0 = millis();
    runVegasMode();
    uint32_t elapsed = millis() - t0;
#if DEBUG_SERIAL
    Serial.print(F("[VEGAS] Duration: "));
    Serial.print(elapsed);
    Serial.println(F(" ms"));
    Serial.println(F("------------------------------------------------"));
#endif
  }

  // ✅ EEPROM Load
  loadStationStatesFromEEPROM(); // restore last enable/disable states

  // ✅ Enable watchdog timer (keep it)
  wdt_enable(WDTO_8S); // Enable only after setup() fully completes

  // TEMP TEMP TEMP TEMP TEMP TEMP
  Serial.println(F("[DEBUG] Initial pin voltages:"));
  for (uint8_t i = 0; i < NUM_INPUTS; i++)
  {
    Serial.print(F("Pin "));
    Serial.print(PHYS_SW_PINS[i]);
    Serial.print(F(" = "));
    Serial.println(digitalRead(PHYS_SW_PINS[i]));
  }
  // END TEMP TEMP TEMP TEMP TEMP TEMP

#if DEBUG_SERIAL
  Serial.println(F("[INIT] Setup complete."));
#endif
}

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

  // 🔁 Refresh physical inputs
  for (uint8_t i = 0; i < NUM_INPUTS; i++)
  {
    stableState[i] = !digitalRead(PHYS_SW_PINS[i]); // active-low
  }

  // 🔁 Refresh MCP23017 inputs each cycle
  if (mcpIntA_Flag)
  {
    readMcpA();
  }
  if (mcpIntB_Flag)
  {
    readMcpB();
  }

  // Update stableState from MCP port snapshots
  for (uint8_t b = 0; b < 8; b++)
  {
    stableState[8 + b] = ((mcpStateA & (1 << b)) == 0);
    stableState[16 + b] = ((mcpStateB & (1 << b)) == 0);
  }

  // 🔁 Blink-phase update (global for all blinking states)
  if (now - tBlink >= BLINK_INTERVAL_MS)
  {
    tBlink = now;
    blinkPhase = !blinkPhase;
  }

  // TEST TEST TEST TEST TEST TEST
  DBG(4, int packetSize = Udp.parsePacket(); if (packetSize > 0) {
      IPAddress rip = Udp.remoteIP();
      Serial.print(F("[RX] Packet from "));
      Serial.print(rip);
      Serial.print(F(" len="));
      Serial.println(packetSize);

      uint8_t buf[8];
      int len = Udp.read(buf, sizeof(buf));
      Serial.print(F(" Data: "));
      for (int i = 0; i < len; i++) {
        Serial.print(buf[i], HEX);
        Serial.print(" ");
      }
      Serial.println();

      if (len == 4 && buf[0] == 0xAB) {
        uint8_t id = buf[1];
        if (id < NUM_STATIONS && xorChecksum(buf, 3) == buf[3]) {
          lastHeartbeatMs[id] = now;
          stationOffline[id] = false;
          DBG(2,
            Serial.print(F("[HB] Station "));
            Serial.print(id);
            Serial.println(F(" OK"));
          );
        }
      }

      else if (len == 5 && buf[0] == 0xAC) {
        uint8_t id = buf[1];
        if (id < NUM_STATIONS && xorChecksum(buf, 4) == buf[4]) {
          stationFeedback[id] = buf[2];
          DBG(2, Serial.print("[FB] Station %u bits=%02X\n");
          Serial.println(id, buf[2]); );
        }
      } });

  // TEST TEST TEST TEST TEST TEST

  // // DBG(2,
  // int pkt = Udp.parsePacket();
  // // if (pkt > 0)
  // // {
  // //   IPAddress rip = Udp.remoteIP();
  // // }

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

  // Long press for station enable / disable
  handleStationEnableLongPress(now);

  // Thermostat
  updateThermostatStatus();

  // 3️⃣ Update station online/offline
  updateHeartbeatStatus(now);

  // 4️⃣ Update LEDs + Ethernet status
  updateEthernetAndLEDs(now);

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