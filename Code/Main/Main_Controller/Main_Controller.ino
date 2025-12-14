/*
  ==========================================================================================
  MAIN CONTROLLER — FIRMWARE v4.8

  UPDATES:
  - Dynamic Burglar Alarm Configuration (Off, ST2, or ST3) via App
  - Expanded Config Packet (0xCF) to 6 bytes
  - Logic checks specific assigned station for intrusion
  ==========================================================================================
*/

#define FIRMWARE_VERSION "v4.8-DynBurglar"
#define DEBUG_SERIAL 1
#define DEBUG_LEVEL 3
#define BUZZER_REMINDER 1
#define ENABLE_VEGAS_MODE 1
// Note: ENABLE_BURGLAR_ALARM removed in favor of dynamic cfgBurglarStation

#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <EEPROM.h>
#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#include <avr/wdt.h>

// --- HARDWARE CONFIG ---
#define MCP_I2C_ADDR 0x27
#define MCP_INTA_PIN 18
#define MCP_INTB_PIN 19
Adafruit_MCP23X17 mcp;

#define ETH_CS 48
#define ETH_RESET 49
const uint16_t UDP_PORT = 8888;
EthernetUDP Udp;
byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED};
IPAddress ipBroadcast(192, 168, 1, 255);
IPAddress ipServer(192, 168, 1, 200);
IPAddress ipMain(192, 168, 1, 220);

// --- BUZZER CONFIGURATION ---
#define PIN_BUZZER 2
#define BUZZER_ALERT_MODE 1

// Configurable Variables (Loaded from EEPROM)
uint32_t cfgAlarmOnMs = 5000;
uint32_t cfgAlarmOffMs = 10000;
uint32_t cfgReminderPeriodMs = 120000;
const uint32_t REMINDER_ON_MS = 500;

// ✅ NEW: Burglar Config (0=Disabled, 2=ST2, 3=ST3)
uint8_t cfgBurglarStation = 0;

// EEPROM Addresses
#define EEPROM_CFG_BASE 100
#define EEPROM_ALARM_ON 100
#define EEPROM_ALARM_OFF 101
#define EEPROM_REMINDER 102
#define EEPROM_BURGLAR_STATION 103 // ✅ NEW ADDRESS

// Timers
uint32_t buzzerAlarmStart = 0;
uint32_t buzzerReminderStart = 0;

// --- STATE & IO ---
bool anyVacuumAlert = false;
bool burglarAlarmActive = false;
bool st2_intruder = false;
bool st3_intruder = false;

#define NUM_STATIONS 6
#define NUM_INPUTS 8
#define NUM_LED_PAIRS 24
#define TOTAL_INPUTS (NUM_INPUTS + 16)

bool rawState[TOTAL_INPUTS] = {0};
bool stableState[TOTAL_INPUTS] = {0};
uint32_t lastChange[TOTAL_INPUTS] = {0};
const uint16_t DEBOUNCE_MS = 50;

bool remoteOverrideActive = false;
uint8_t remoteSwitchBytes[3] = {0, 0, 0};
uint32_t lastServerPacketMs = 0;
const uint32_t SERVER_TIMEOUT_MS = 3000;

const uint8_t PHYS_SW_PINS[NUM_INPUTS] = {62, 63, 64, 65, 66, 67, 68, 69};
const uint8_t LED_A[NUM_LED_PAIRS] = {4, 6, 8, 10, 12, 14, 16, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 54, 56, 58, 60};
const uint8_t LED_B[NUM_LED_PAIRS] = {5, 7, 9, 11, 13, 15, 17, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 55, 57, 59, 61};

// --- MAPPINGS ---
struct InputMap
{
  uint8_t index;
  bool isMCP;
  uint8_t pinOrBit;
  uint8_t mcpId;
  uint8_t station;
  uint8_t bit;
};
const InputMap INPUT_MAP[] = {
    {0, false, 62, 0, 1, 0}, {1, false, 63, 0, 1, 1}, {2, false, 64, 0, 0, 0}, {3, false, 65, 0, 0, 1}, {4, false, 66, 0, 1, 2}, {5, false, 67, 0, 1, 3}, {6, false, 68, 0, 1, 4}, {7, false, 69, 0, 1, 5}, {8, true, 0, 0, 2, 0}, {9, true, 1, 0, 2, 1}, {10, true, 2, 0, 2, 2}, {11, true, 3, 0, 2, 3}, {12, true, 4, 0, 3, 0}, {13, true, 5, 0, 3, 1}, {14, true, 6, 0, 3, 2}, {15, true, 7, 0, 3, 3}, {16, true, 0, 1, 4, 0}, {17, true, 1, 1, 4, 1}, {18, true, 2, 1, 4, 2}, {19, true, 3, 1, 5, 0}, {20, true, 4, 1, 5, 1}, {21, true, 5, 1, 255, 0}, {22, true, 6, 1, 255, 0}, {23, true, 7, 1, 255, 0}};
const uint8_t INPUT_MAP_COUNT = sizeof(INPUT_MAP) / sizeof(INPUT_MAP[0]);

struct LedMap
{
  uint8_t ledPair;
  uint8_t station;
  uint8_t bit;
  int8_t offlineStation;
  bool isVacuum;
  int8_t switchIndex;
};
const LedMap LED_MAP[] = {
    {0, 1, 0, 0, 0, 0},
    {1, 1, 1, 1, 0, 1},
    {2, 1, 2, 1, 1, 2},
    {3, 1, 2, 1, 1, 3},
    {4, 1, 3, 1, 0, 4},
    {5, 1, 4, 1, 0, 5},
    {6, 1, 5, 1, 0, 6},
    {7, 1, 6, 1, 0, 7},
    {8, 2, 0, 2, 0, 8},
    {9, 2, 1, 2, 1, 9},
    {10, 2, 2, 2, 0, 10},
    {11, 2, 3, 2, 0, 11},
    {12, 3, 0, 3, 0, 12},
    {13, 3, 1, 3, 0, 13},
    {14, 3, 2, 3, 1, 14},
    {15, 3, 3, 3, 0, 15},
    {16, 4, 0, 4, 0, 16},
    {17, 4, 1, 4, 1, 17},
    {18, 4, 2, 4, 0, 18},
    {19, 5, 0, 5, 0, 19},
    {20, 5, 1, 5, 0, 20},
};
const uint8_t LED_MAP_COUNT = sizeof(LED_MAP) / sizeof(LED_MAP[0]);

// --- MACROS ---
#define LED_RED(idx, on) digitalWrite(LED_A[idx], (on))
#define LED_GREEN(idx, on) digitalWrite(LED_B[idx], (on))
#define LED_PAIR(idx, redOn, greenOn)    \
  do                                     \
  {                                      \
    digitalWrite(LED_A[idx], (redOn));   \
    digitalWrite(LED_B[idx], (greenOn)); \
  } while (0)

#define VEGAS_DELAY_MS 60
#define VEGAS_FLASHES 3
const uint32_t LONGPRESS_MS = 5000;

// --- GLOBALS ---
bool stationEnabled[NUM_STATIONS] = {true};
bool stationOffline[NUM_STATIONS] = {false};
uint8_t stationFeedback[NUM_STATIONS] = {0};
bool firstHeartbeatSeen[NUM_STATIONS] = {false};
bool pressActive[NUM_STATIONS] = {false};
uint32_t pressStart[NUM_STATIONS] = {0};
const uint8_t stationButtonIndex[NUM_STATIONS] = {0, 1, 8, 12, 16, 19};

// Thermostat
#define ENABLE_THERMOSTAT true
const uint8_t TH_SWITCH_IDX[2] = {22, 23};
const uint8_t TH_LED_PAIR[2] = {22, 23};
const uint8_t TH_FEEDBACK_STATION[2] = {0, 4};
const uint8_t TH_FEEDBACK_BIT[2] = {3, 3};
const uint8_t TH1_OVERRIDE_IDX[] = {2, 9, 14};
const uint8_t TH2_OVERRIDE_IDX[] = {17};
const uint8_t *TH_OVERRIDE_IDX[2] = {TH1_OVERRIDE_IDX, TH2_OVERRIDE_IDX};
const uint8_t TH_OVERRIDE_COUNT[2] = {3, 1};
bool thermostatEnabled[2] = {false, false};
bool thermostatActive[2] = {false, false};

// Buzzer Config
const uint8_t BUZZER_SWITCH_IDX = 21;
#define BUZZER_LED_PAIR 21

// Runtime
volatile bool mcpIntA_Flag = false;
volatile bool mcpIntB_Flag = false;
uint8_t mcpStateA = 0xFF;
uint8_t mcpStateB = 0xFF;

// Timing
const uint16_t SEND_INTERVAL_MS = 50;
const uint16_t LINK_CHECK_INTERVAL = 250;
const uint16_t HEARTBEAT_TIMEOUT_MS = 2000;
const uint16_t BLINK_INTERVAL_MS = 250;
uint32_t lastHeartbeatMs[NUM_STATIONS] = {0};
uint32_t tSend = 0;
uint32_t lastLinkCheck = 0;
uint32_t tBlink = 0;
bool blinkPhase = false;

// ============================================================
// 🧩 UTILS
// ============================================================
void readMcpA()
{
  while (digitalRead(MCP_INTA_PIN) == LOW)
  {
    mcpStateA = mcp.readGPIO(0);
    delayMicroseconds(50);
  }
  mcpIntA_Flag = false;
}
void readMcpB()
{
  while (digitalRead(MCP_INTB_PIN) == LOW)
  {
    mcpStateB = mcp.readGPIO(1);
    delayMicroseconds(50);
  }
  mcpIntB_Flag = false;
}
bool readInputByMap(const InputMap &m)
{
  if (m.isMCP)
  {
    uint8_t portState = (m.mcpId == 0) ? mcpStateA : mcpStateB;
    return ((portState & (1 << m.pinOrBit)) == 0);
  }
  else
  {
    return !digitalRead(m.pinOrBit);
  }
}
void digitalWriteAll(const uint8_t *pins, uint8_t count, bool state)
{
  for (uint8_t i = 0; i < count; i++)
    digitalWrite(pins[i], state);
}

// ============================================================
// 🔍 HELPER: Check if System is Running
// ============================================================
bool isSystemRunning()
{
  if (((stationFeedback[1] >> 2) & 1) == 0 && stationEnabled[1])
    return true;
  if (((stationFeedback[1] >> 2) & 1) == 0 && stationEnabled[1])
    return true;
  if (((stationFeedback[2] >> 1) & 1) == 0 && stationEnabled[2])
    return true;
  if (((stationFeedback[3] >> 2) & 1) == 0 && stationEnabled[3])
    return true;
  if (((stationFeedback[4] >> 1) & 1) == 0 && stationEnabled[4])
    return true;
  return false;
}

// ============================================================
// 💾 CONFIGURATION LOAD/SAVE
// ============================================================
void loadConfig()
{
  uint8_t aOn = EEPROM.read(EEPROM_ALARM_ON);
  uint8_t aOff = EEPROM.read(EEPROM_ALARM_OFF);
  uint8_t remMin = EEPROM.read(EEPROM_REMINDER);

  // ✅ NEW: Burglar Source
  uint8_t burgSt = EEPROM.read(EEPROM_BURGLAR_STATION);

  // Defaults
  cfgAlarmOnMs = (aOn == 0xFF) ? 5000 : (uint32_t)aOn * 1000;
  cfgAlarmOffMs = (aOff == 0xFF) ? 10000 : (uint32_t)aOff * 1000;
  cfgReminderPeriodMs = (remMin == 0xFF) ? 120000 : (uint32_t)remMin * 60000;
  cfgBurglarStation = (burgSt == 0xFF) ? 0 : burgSt; // Default 0 (Disabled)

  // Safety
  if (cfgAlarmOnMs < 1000)
    cfgAlarmOnMs = 1000;
  if (cfgAlarmOffMs < 1000)
    cfgAlarmOffMs = 1000;
  if (cfgReminderPeriodMs < 60000)
    cfgReminderPeriodMs = 60000;
  // Burglar station must be 0, 2, or 3
  if (cfgBurglarStation != 0 && cfgBurglarStation != 2 && cfgBurglarStation != 3)
    cfgBurglarStation = 0;

#if DEBUG_SERIAL
  Serial.print(F("[CFG] On="));
  Serial.print(cfgAlarmOnMs);
  Serial.print(F(" Off="));
  Serial.print(cfgAlarmOffMs);
  Serial.print(F(" Rem="));
  Serial.print(cfgReminderPeriodMs);
  Serial.print(F(" BurgSt="));
  Serial.println(cfgBurglarStation);
#endif
}

// ============================================================
// 🔔 BUZZER LOGIC
// ============================================================
void updateBuzzerLED(uint32_t now)
{
  if (Ethernet.linkStatus() != LinkON)
  {
    digitalWrite(PIN_BUZZER, LOW);
    return;
  }

  bool switchOn = stableState[BUZZER_SWITCH_IDX];
  bool alert = anyVacuumAlert || burglarAlarmActive;

  if (alert)
  {
    buzzerReminderStart = 0;
    LED_PAIR(BUZZER_LED_PAIR, blinkPhase ? HIGH : LOW, LOW);

    if (switchOn)
    {
      if (buzzerAlarmStart == 0)
        buzzerAlarmStart = now;
      uint32_t elapsed = now - buzzerAlarmStart;
      uint32_t cycle = cfgAlarmOnMs + cfgAlarmOffMs;
      if (elapsed >= cycle)
      {
        buzzerAlarmStart = now;
        elapsed = 0;
      }
      digitalWrite(PIN_BUZZER, (elapsed < cfgAlarmOnMs) ? HIGH : LOW);
    }
    else
    {
      digitalWrite(PIN_BUZZER, LOW);
      buzzerAlarmStart = 0;
    }
    return;
  }

  buzzerAlarmStart = 0;
  digitalWrite(PIN_BUZZER, LOW);
  LED_PAIR(BUZZER_LED_PAIR, switchOn ? LOW : HIGH, switchOn ? HIGH : LOW);

#if BUZZER_REMINDER
  if (!switchOn && isSystemRunning())
  {
    if (buzzerReminderStart == 0)
      buzzerReminderStart = now;
    uint32_t elapsed = now - buzzerReminderStart;
    if (elapsed >= cfgReminderPeriodMs)
    {
      buzzerReminderStart = now;
      elapsed = 0;
    }
    if (elapsed < REMINDER_ON_MS)
    {
      digitalWrite(PIN_BUZZER, HIGH);
      LED_PAIR(BUZZER_LED_PAIR, HIGH, LOW);
    }
    else
    {
      digitalWrite(PIN_BUZZER, LOW);
      LED_PAIR(BUZZER_LED_PAIR, HIGH, LOW);
    }
    return;
  }
#endif
  buzzerReminderStart = 0;
}

// ============================================================
// 🌐 LED & LINK LOGIC
// ============================================================
void updateEthernetAndLEDs(uint32_t now)
{
  static bool linkDown = false;
  if (now - lastLinkCheck >= LINK_CHECK_INTERVAL)
  {
    lastLinkCheck = now;
    linkDown = (Ethernet.linkStatus() != LinkON);
  }
  if (linkDown)
  {
    digitalWriteAll(LED_B, NUM_LED_PAIRS, LOW);
    digitalWriteAll(LED_A, NUM_LED_PAIRS, blinkPhase);
    return;
  }

  anyVacuumAlert = false;

  // ✅ DYNAMIC BURGLAR CHECK
  burglarAlarmActive = false;
  st2_intruder = false;
  st3_intruder = false;

  if (cfgBurglarStation == 2)
  {
    // Check if ST2 Enabled and Bit 4 Active
    if (stationEnabled[2] && ((stationFeedback[2] >> 4) & 1))
    {
      st2_intruder = true;
      burglarAlarmActive = true;
    }
  }
  else if (cfgBurglarStation == 3)
  {
    // Check if ST3 Enabled and Bit 4 Active
    if (stationEnabled[3] && ((stationFeedback[3] >> 4) & 1))
    {
      st3_intruder = true;
      burglarAlarmActive = true;
    }
  }

  for (uint8_t i = 0; i < LED_MAP_COUNT; i++)
  {
    const LedMap &m = LED_MAP[i];
    if (!stationEnabled[m.offlineStation])
    {
      LED_PAIR(m.ledPair, LOW, LOW);
      continue;
    }
    if (m.offlineStation != (uint8_t)-1 && stationOffline[m.offlineStation])
    {
      LED_PAIR(m.ledPair, blinkPhase ? HIGH : LOW, blinkPhase ? LOW : HIGH);
      continue;
    }

    // ✅ BURGLAR VISUALS (Priority)
    // Only flash if this specific station is the one triggered
    if ((st2_intruder && m.station == 2) || (st3_intruder && m.station == 3))
    {
      // ✅ CHANGED: Red Blink Only (Was Red/Green)
      LED_PAIR(m.ledPair, blinkPhase ? HIGH : LOW, LOW);
      continue;
    }

    bool bitVal = (stationFeedback[m.station] >> m.bit) & 1;
    bool isCommandedOn = stableState[m.switchIndex];
#if ENABLE_THERMOSTAT
    for (uint8_t t = 0; t < 2; t++)
    {
      if (thermostatEnabled[t] && thermostatActive[t])
      {
        for (uint8_t k = 0; k < TH_OVERRIDE_COUNT[t]; k++)
        {
          if (m.switchIndex == TH_OVERRIDE_IDX[t][k])
          {
            isCommandedOn = true;
            break;
          }
        }
      }
    }
#endif
    if (m.isVacuum && isCommandedOn && bitVal)
    {
      anyVacuumAlert = true;
      LED_PAIR(m.ledPair, blinkPhase ? HIGH : LOW, LOW);
      continue;
    }
    LED_PAIR(m.ledPair, bitVal ? HIGH : LOW, bitVal ? LOW : HIGH);
  }
}

// ... [HELPERS SAME] ...
void updateThermostatStatus()
{
  if (!ENABLE_THERMOSTAT)
  {
    LED_PAIR(TH_LED_PAIR[0], LOW, LOW);
    LED_PAIR(TH_LED_PAIR[1], LOW, LOW);
    return;
  }
  if (Ethernet.linkStatus() != LinkON)
    return;
  for (uint8_t i = 0; i < 2; i++)
  {
    thermostatEnabled[i] = stableState[TH_SWITCH_IDX[i]];
    bool bitLow = ((stationFeedback[TH_FEEDBACK_STATION[i]] & (1 << TH_FEEDBACK_BIT[i])) == 0);
    thermostatActive[i] = bitLow;
    if (remoteOverrideActive)
    {
      LED_PAIR(TH_LED_PAIR[i], LOW, blinkPhase);
    }
    else if (thermostatEnabled[i])
    {
      if (thermostatActive[i])
        LED_PAIR(TH_LED_PAIR[i], LOW, HIGH);
      else
        LED_PAIR(TH_LED_PAIR[i], HIGH, LOW);
    }
    else
    {
      LED_PAIR(TH_LED_PAIR[i], LOW, LOW);
    }
  }
}
void runVegasMode()
{
  if (!ENABLE_VEGAS_MODE)
    return;
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
  {
    digitalWrite(LED_A[i], HIGH);
    delay(VEGAS_DELAY_MS);
    digitalWrite(LED_A[i], LOW);
  }
  delay(200);
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
  {
    digitalWrite(LED_B[i], HIGH);
    delay(VEGAS_DELAY_MS);
    digitalWrite(LED_B[i], LOW);
  }
  delay(200);
  for (int k = 0; k < 3; k++)
  {
    for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
      LED_PAIR(i, HIGH, LOW);
    delay(200);
    for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
      LED_PAIR(i, LOW, HIGH);
    delay(200);
  }
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
    LED_PAIR(i, LOW, LOW);
}
void initEthernet()
{
  SPI.begin();
  pinMode(ETH_RESET, OUTPUT);
  digitalWrite(ETH_RESET, LOW);
  delay(200);
  digitalWrite(ETH_RESET, HIGH);
  delay(800);
  Ethernet.init(ETH_CS);
  Ethernet.begin(mac, ipMain);
  Udp.begin(UDP_PORT);
  Ethernet.setRetransmissionCount(1);
  Ethernet.setRetransmissionTimeout(200);
}
inline uint8_t xorChecksum(const uint8_t *d, uint8_t l)
{
  uint8_t c = 0;
  for (uint8_t i = 0; i < l; i++)
    c ^= d[i];
  return c;
}
inline uint8_t packBitsLSB(const bool *arr, uint8_t n)
{
  uint8_t v = 0;
  for (uint8_t i = 0; i < n; i++)
    v |= arr[i] << i;
  return v;
}

// ... [PACKET HANDLING] ...
void sendGlobalCommands()
{
  uint8_t packet[10];
  packet[0] = 0xBB;
  packet[1] = 0x00;
  packet[2] = 0x01;
  for (uint8_t st = 0; st < NUM_STATIONS; st++)
  {
    bool bits[8] = {0};
    uint8_t bitCount = 0;
    if (stationEnabled[st])
    {
      for (uint8_t i = 0; i < INPUT_MAP_COUNT; i++)
      {
        const InputMap &m = INPUT_MAP[i];
        if (m.station == st)
        {
          bool val = stableState[m.index];
#if ENABLE_THERMOSTAT
          for (uint8_t t = 0; t < 2; t++)
          {
            if (thermostatEnabled[t] && thermostatActive[t])
            {
              for (uint8_t k = 0; k < TH_OVERRIDE_COUNT[t]; k++)
              {
                if (m.index == TH_OVERRIDE_IDX[t][k])
                {
                  val = true;
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
      if (burglarAlarmActive && st == 0)
      {
        bits[3] = true;
        if (bitCount < 4)
          bitCount = 4;
      }
    }
    else
    {
      bits[7] = 1;
      bitCount = 8;
    }
    packet[3 + st] = packBitsLSB(bits, bitCount);
  }
  packet[9] = xorChecksum(packet, 9);
  Udp.beginPacket(ipBroadcast, UDP_PORT);
  Udp.write(packet, 10);
  Udp.endPacket();
}

void sendPhysicalState()
{
  uint8_t payload[3] = {0};
  for (int i = 0; i < 24; i++)
  {
    if (rawState[i])
      payload[i / 8] |= (1 << (i % 8));
  }
  uint8_t packet[7] = {0xB1, 0x01, payload[0], payload[1], payload[2], (uint8_t)(remoteOverrideActive ? 1 : 0), 0};
  packet[6] = xorChecksum(packet, 6);
  Udp.beginPacket(ipBroadcast, UDP_PORT);
  Udp.write(packet, 7);
  Udp.endPacket();
}

void processHeartbeatAndFeedback(uint32_t now)
{
  int count = 0;
  while (Udp.parsePacket() > 0 && count < 10)
  {
    count++;
    uint8_t buf[16];
    int n = Udp.read(buf, sizeof(buf));
    if (n < 3)
      continue;
    if (buf[0] == 0xAB && n >= 4)
    {
      uint8_t id = buf[1];
      if (((buf[0] ^ buf[1] ^ buf[2]) == buf[3]) && id < NUM_STATIONS)
      {
        lastHeartbeatMs[id] = now;
        stationOffline[id] = false;
        if (!firstHeartbeatSeen[id])
          firstHeartbeatSeen[id] = true;
      }
    }
    else if (buf[0] == 0xAC && n >= 5)
    {
      uint8_t id = buf[1];
      if (((buf[0] ^ buf[1] ^ buf[2] ^ buf[3]) == buf[4]) && id < NUM_STATIONS)
      {
        stationFeedback[id] = buf[2];
        lastHeartbeatMs[id] = now;
        stationOffline[id] = false;
      }
    }
    else if (buf[0] == 0xAF && n >= 3)
    {
      if ((buf[0] ^ buf[1]) == buf[2])
      {
        remoteOverrideActive = (buf[1] == 0x01);
        lastServerPacketMs = now;
      }
    }
    else if (buf[0] == 0xB0 && n >= 5)
    {
      if ((buf[0] ^ buf[1] ^ buf[2] ^ buf[3]) == buf[4] && remoteOverrideActive)
      {
        remoteSwitchBytes[0] = buf[1];
        remoteSwitchBytes[1] = buf[2];
        remoteSwitchBytes[2] = buf[3];
        lastLinkCheck = now;
        lastServerPacketMs = now;
      }
    }

    // ✅ NEW: 6-BYTE CONFIG PACKET [0xCF] [On] [Off] [Rem] [BurgSt] [Cks]
    else if (buf[0] == 0xCF && n >= 6)
    {
      uint8_t onSec = buf[1];
      uint8_t offSec = buf[2];
      uint8_t remMin = buf[3];
      uint8_t burgSt = buf[4];
      uint8_t calcChecksum = buf[0] ^ buf[1] ^ buf[2] ^ buf[3] ^ buf[4];

      if (buf[5] == calcChecksum)
      {
        EEPROM.update(EEPROM_ALARM_ON, onSec);
        EEPROM.update(EEPROM_ALARM_OFF, offSec);
        EEPROM.update(EEPROM_REMINDER, remMin);
        EEPROM.update(EEPROM_BURGLAR_STATION, burgSt);
        loadConfig(); // Reload
      }
    }
  }
}

// ... [EEPROM & LOOPS] ...
void loadStationStatesFromEEPROM()
{
  for (uint8_t i = 0; i < NUM_STATIONS; i++)
  {
    uint8_t val = EEPROM.read(i);
    stationEnabled[i] = (val != 0xFF && val <= 1) ? val : true;
  }
}
void saveStationStateToEEPROM(uint8_t id)
{
  if (id < NUM_STATIONS)
    EEPROM.update(id, stationEnabled[id]);
}
void handleStationEnableLongPress(uint32_t now)
{
  for (uint8_t id = 0; id < NUM_STATIONS; id++)
  {
    uint8_t idx = stationButtonIndex[id];
    bool pressed = stableState[idx];
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
      stationEnabled[id] = !stationEnabled[id];
      pressActive[id] = false;
      saveStationStateToEEPROM(id);
    }
  }
}

void setup()
{
  wdt_disable();
  delay(1000);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++)
  {
    pinMode(LED_A[i], OUTPUT);
    pinMode(LED_B[i], OUTPUT);
    LED_PAIR(i, LOW, LOW);
  }
  initEthernet();
  mcp.begin_I2C(MCP_I2C_ADDR);
  for (uint8_t p = 0; p < 8; p++)
  {
    mcp.pinMode(p, INPUT_PULLUP);
    mcp.pinMode(p + 8, INPUT_PULLUP);
  }
  mcp.setupInterrupts(false, false, LOW);
  for (uint8_t p = 0; p < 16; p++)
    mcp.setupInterruptPin(p, CHANGE);
  pinMode(MCP_INTA_PIN, INPUT_PULLUP);
  pinMode(MCP_INTB_PIN, INPUT_PULLUP);
  mcpStateA = mcp.readGPIO(0);
  mcpStateB = mcp.readGPIO(1);
  attachInterrupt(digitalPinToInterrupt(MCP_INTA_PIN), []()
                  { mcpIntA_Flag = true; }, FALLING);
  attachInterrupt(digitalPinToInterrupt(MCP_INTB_PIN), []()
                  { mcpIntB_Flag = true; }, FALLING);
  for (uint8_t i = 0; i < NUM_INPUTS; i++)
  {
    pinMode(PHYS_SW_PINS[i], INPUT_PULLUP);
    stableState[i] = !digitalRead(PHYS_SW_PINS[i]);
  }
  for (uint8_t b = 0; b < 8; b++)
  {
    stableState[NUM_INPUTS + b] = ((mcpStateA & (1 << b)) == 0);
    stableState[NUM_INPUTS + 8 + b] = ((mcpStateB & (1 << b)) == 0);
  }
  if (ENABLE_VEGAS_MODE)
    runVegasMode();
  loadStationStatesFromEEPROM();
  loadConfig();
  wdt_enable(WDTO_8S);
}

void loop()
{
  wdt_reset();
  uint32_t now = millis();
  if (mcpIntA_Flag)
    readMcpA();
  if (mcpIntB_Flag)
    readMcpB();
  for (uint8_t i = 0; i < INPUT_MAP_COUNT; i++)
  {
    const InputMap &m = INPUT_MAP[i];
    bool curr = readInputByMap(m);
    if (curr != rawState[m.index])
    {
      rawState[m.index] = curr;
      lastChange[m.index] = now;
    }
    if (!remoteOverrideActive && (now - lastChange[m.index] > DEBOUNCE_MS))
      stableState[m.index] = rawState[m.index];
  }
  processHeartbeatAndFeedback(now);
  for (uint8_t id = 0; id < NUM_STATIONS; id++)
  {
    if (now - lastHeartbeatMs[id] > HEARTBEAT_TIMEOUT_MS)
      stationOffline[id] = true;
  }
  handleStationEnableLongPress(now);
  if (remoteOverrideActive && (now - lastServerPacketMs > SERVER_TIMEOUT_MS))
    remoteOverrideActive = false;
  static uint32_t emergStart = 0;
  if (remoteOverrideActive)
  {
    if (!digitalRead(62) && !digitalRead(63))
    {
      if (emergStart == 0)
        emergStart = now;
      else if (now - emergStart > 2000)
      {
        remoteOverrideActive = false;
        emergStart = 0;
        for (int k = 0; k < 5; k++)
        {
          digitalWriteAll(LED_B, NUM_LED_PAIRS, HIGH);
          delay(100);
          wdt_reset();
          digitalWriteAll(LED_B, NUM_LED_PAIRS, LOW);
          delay(100);
          wdt_reset();
        }
      }
    }
    else
      emergStart = 0;
  }
  updateEthernetAndLEDs(now);
  updateBuzzerLED(now);
  updateThermostatStatus();
  static uint32_t tPhys = 0;
  if (now - tPhys >= 200)
  {
    tPhys = now;
    sendPhysicalState();
  }
  if (!remoteOverrideActive && (now - tSend >= 100))
  {
    tSend = now;
    sendGlobalCommands();
  }
  if (now - tBlink >= BLINK_INTERVAL_MS)
  {
    tBlink = now;
    blinkPhase = !blinkPhase;
  }
}