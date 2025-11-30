// -------------------- SYSTEM DEFINES --------------------
#define FIRMWARE_VERSION "v1.0-Optimized"
#define HAS_TM1637 1
#define ENABLE_VEGAS_MODE 1
#define DEBUG_SERIAL 1
#define DEBUG_LEVEL 2 // Reduced level to speed up serial

// ============================================================
// 🧩 LIBRARIES
// ============================================================
#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <EEPROM.h>
#include <avr/wdt.h>

#if HAS_TM1637
#include <TM1637Display.h>
const uint8_t CLK_PIN = 8;
const uint8_t DIO_PIN = 9;
TM1637Display display(CLK_PIN, DIO_PIN);
#endif

// ============================================================
// 🚧 DEBUG MACROS
// ============================================================
const uint16_t DBG_THROTTLE_MS[4] = {0, 500, 1000, 3000};
uint32_t dbgLastPrint[4] = {0, 0, 0, 0};

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

// ============================================================
// 🧩 PIN DEFINITIONS
// ============================================================
const uint8_t OUT_PINS[6] = {2, 3, 4, 5, 6, 7};  // Relays
const uint8_t IN_PINS[5] = {A1, A2, A3, A4, A5}; // Inputs 0-4
#define IN_PIN_A6 A6                             // Inputs 5 & 6 (Analog Ladder)
#define BTN_PIN A7                               // Station Cycle Button

// Ethernet Pins
#define ETH_CS 10
#define ETH_RST A0

// ============================================================
// 🌐 NETWORK CONFIG
// ============================================================
byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0x02, 0x10};
IPAddress ipBroadcast(192, 168, 1, 255);
IPAddress ip(192, 168, 1, 211);
const uint16_t UDP_PORT = 8888;
EthernetUDP Udp;

// State Variables
uint8_t STATION_ID = 0;
uint8_t lastFeedbackBits = 0;
uint8_t pendingID = 0;
bool reconfigPending = false;
uint32_t lastButtonTime = 0;

// Timing
uint32_t tHeartbeat = 0;
uint32_t lastCmdMs = 0;
const uint16_t CMD_WATCHDOG_MS = 4000;
const uint16_t RECONFIG_DELAY_MS = 1500;

// ============================================================
// 🖥 DISPLAY STATE
// ============================================================
enum DisplayMode
{
  DISP_NORMAL,
  DISP_ERROR,
  DISP_LINK,
  DISP_NETCFG
};
DisplayMode displayMode = DISP_NORMAL;
bool displayFlash = false;
uint32_t lastDisplayUpdate = 0;

// ============================================================
// 🔧 UTILITIES
// ============================================================
uint8_t xorChecksum(const uint8_t *data, uint8_t len)
{
  uint8_t c = 0;
  for (uint8_t i = 0; i < len; i++)
    c ^= data[i];
  return c;
}

void ethernetResetPulse()
{
  pinMode(ETH_CS, OUTPUT);
  digitalWrite(ETH_CS, HIGH);
  pinMode(ETH_RST, OUTPUT);
  digitalWrite(ETH_RST, LOW);
  delay(200);
  digitalWrite(ETH_RST, HIGH);
  delay(800);
}

void initEthernet(bool fullReset)
{
  if (fullReset)
  {
    Serial.println(F("[NET] Init..."));
    SPI.begin();
    ethernetResetPulse();

    // Manual Wakeup
    SPI.beginTransaction(SPISettings(8000000, MSBFIRST, SPI_MODE0));
    digitalWrite(ETH_CS, LOW);
    SPI.transfer(0x00);
    SPI.transfer(0x39);
    SPI.transfer(0x00);
    byte ver = SPI.transfer(0x00);
    digitalWrite(ETH_CS, HIGH);
    SPI.endTransaction();
    if (ver == 0x04)
      Serial.println(F("[NET] Chip Found (0x04)"));
  }

  Ethernet.init(ETH_CS);
  Ethernet.begin(mac, ip);
  Udp.begin(UDP_PORT);

  if (Ethernet.localIP()[0] == 0)
    Serial.println(F("[NET] IP Failed"));
  else
  {
    Serial.print(F("[NET] IP: "));
    Serial.println(Ethernet.localIP());
  }
}

void reconfigureNetwork(bool fullReset)
{
  ip = IPAddress(192, 168, 1, 210 + STATION_ID);
  mac[5] = 0x10 + STATION_ID;
  initEthernet(fullReset);
  lastCmdMs = millis();
}

void loadStationID()
{
  uint8_t id = EEPROM.read(0);
  STATION_ID = (id > 5) ? 0 : id;
}

void saveStationID(uint8_t id)
{
  if (EEPROM.read(0) != id)
    EEPROM.update(0, id);
}

// ============================================================
// 🕹️ INPUT & OUTPUT LOGIC
// ============================================================
void applyRelays(uint8_t bits)
{
  for (uint8_t i = 0; i < 6; i++)
  {
    digitalWrite(OUT_PINS[i], (bits & (1 << i)) ? HIGH : LOW);
  }
}

uint8_t readInputs()
{
  uint8_t bits = 0;
  // 1. Digital Inputs 0-4
  for (uint8_t i = 0; i < 5; i++)
  {
    if (digitalRead(IN_PINS[i]) == LOW)
      bits |= (1 << i);
  }
  // 2. Analog Ladder (Inputs 5 & 6) on A6
  int val = analogRead(IN_PIN_A6);
  if (val < 850)
  {
    if (val < 500)
    {
      bits |= (1 << 5) | (1 << 6);
    } // Both
    else if (val < 605)
    {
      bits |= (1 << 5);
    } // Sw 6 Only
    else
    {
      bits |= (1 << 6);
    } // Sw 7 Only
  }
  return bits;
}

// ============================================================
// 🖥 OPTIMIZED DISPLAY UPDATE
// ============================================================
void updateDisplay(uint32_t now)
{
#if HAS_TM1637
  // Only update every 500ms to save CPU
  if (now - lastDisplayUpdate < 500)
    return;
  lastDisplayUpdate = now;

  displayFlash = !displayFlash; // Toggle blink state

  if (reconfigPending)
  {
    display.showNumberDecEx(pendingID, 0, false, 1, 0);
    return;
  }

  if (displayMode == DISP_NORMAL)
  {
    // Show "ID" with blinking colon
    display.showNumberDecEx(STATION_ID, displayFlash ? 0x40 : 0, true);
  }
  else if (displayMode == DISP_ERROR)
  {
    // Blink "Err"
    if (displayFlash)
    {
      const uint8_t err[] = {0x79, 0x50, 0x50, 0};
      display.setSegments(err);
    }
    else
      display.clear();
  }
#endif
}

// ============================================================
// 🚀 MAIN LOOP
// ============================================================
void setup()
{
  wdt_disable();
  delay(500);
#if DEBUG_SERIAL
  Serial.begin(115200);
#endif

  // Pins
  pinMode(BTN_PIN, INPUT);
  for (uint8_t p : OUT_PINS)
    pinMode(p, OUTPUT);
  for (uint8_t p : IN_PINS)
    pinMode(p, INPUT_PULLUP);

  // Load Config
  loadStationID();
  pendingID = STATION_ID;

#if HAS_TM1637
  display.setBrightness(0x0F);
  display.showNumberDec(STATION_ID);
#endif

  // Network
  reconfigureNetwork(true);

  wdt_enable(WDTO_4S);
}

void loop()
{
  wdt_reset();
  uint32_t now = millis();

  // 1. BUTTON CHECK (Station ID Cycle)
  // Simplified Logic for speed
  if (analogRead(BTN_PIN) < 200)
  {
    if (now - lastButtonTime > 300)
    { // Debounce
      pendingID = (pendingID + 1) % 6;
      reconfigPending = true;
      lastButtonTime = now;
#if HAS_TM1637
      display.showNumberDecEx(pendingID, 0, false, 1, 0);
#endif
    }
  }
  else if (reconfigPending && (now - lastButtonTime > RECONFIG_DELAY_MS))
  {
    // Commit Change
    STATION_ID = pendingID;
    saveStationID(STATION_ID);
    reconfigPending = false;
    reconfigureNetwork(false);
  }

  // 2. NETWORK RX (High Performance Loop)
  int packets = 0;
  while (Udp.parsePacket() > 0 && packets < 20)
  {
    packets++;
    uint8_t buf[32];
    int n = Udp.read(buf, sizeof(buf));

    // HEADER CHECK: 0xBB (Global Sync)
    if (n >= 10 && buf[0] == 0xBB)
    {
      if (xorChecksum(buf, n - 1) == buf[n - 1])
      {
        // Valid Command!
        // Offset: 3 + ID
        if ((3 + STATION_ID) < (n - 1))
        {
          applyRelays(buf[3 + STATION_ID]);
          lastCmdMs = now; // Watchdog Kick
          displayMode = DISP_NORMAL;
        }
      }
    }

    // HEADER CHECK: 0xAD (Ping/Conflict Check)
    else if (n >= 3 && buf[0] == 0xAD)
    {
      if (buf[1] == STATION_ID)
      {
        // Immediate Reply Required
        // We handle this by forcing the feedback loop below to run instantly
        // But currently we just treat it as a "Keep Alive"
        displayMode = DISP_NORMAL;
      }
    }
  }

  // 3. WATCHDOG LOGIC
  if (now - lastCmdMs > CMD_WATCHDOG_MS)
  {
    displayMode = DISP_ERROR;
    // Attempt mild reconnect if lost for too long (10s)
    if (now - lastCmdMs > 10000)
    {
      reconfigureNetwork(false);
      lastCmdMs = now; // Reset to prevent loop
    }
  }

  // 4. FEEDBACK TX (Only on Change or Heartbeat)
  uint8_t currentBits = readInputs();
  static uint32_t lastTxTime = 0;
  bool timeToSend = (now - lastTxTime > 500); // 2Hz Heartbeat
  bool changed = (currentBits != lastFeedbackBits);

  if (changed || timeToSend)
  {
    lastFeedbackBits = currentBits;
    lastTxTime = now;

    uint8_t invBits = ~currentBits; // Active Low Logic for Main
    uint8_t fb[5] = {0xAC, STATION_ID, invBits, 0x00, 0};
    fb[4] = xorChecksum(fb, 4);

    // BROADCAST FEEDBACK
    Udp.beginPacket(ipBroadcast, UDP_PORT);
    Udp.write(fb, 5);
    Udp.endPacket();
  }

  // 5. UPDATE DISPLAY
  updateDisplay(now);
}