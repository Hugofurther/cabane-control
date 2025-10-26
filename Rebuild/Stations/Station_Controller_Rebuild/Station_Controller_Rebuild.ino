// -------------------- SYSTEM DEFINES --------------------
#define FIRMWARE_VERSION "v1.0-RebuildStep1"
#define HAS_TM1637 1        // Set to true when a display is connected
#define ENABLE_VEGAS_MODE 1 // Set false to skip startup LED

// ============================================================
// 🧩 SECTION: FORWARD DECLARATIONS (tell compiler these exist later)
// ============================================================

// ============================================================
// 🧩 SECTION: INCLUDE LIBRARIES
// ============================================================

#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <EEPROM.h>

#if HAS_TM1637
#include <TM1637Display.h>
const uint8_t CLK_PIN = 8;
const uint8_t DIO_PIN = 9;
TM1637Display display(CLK_PIN, DIO_PIN);
#endif

// ============================================================
// 🚧 SECTION: DEBUG CONFIG
// ============================================================
#define DEBUG_SERIAL 1 // for the else clauses

// Limit how often serial debug lines are printed
// ---------------- DEBUG CONFIG ----------------
#define DEBUG_LEVEL 3                                     // 0 = Off, 1 = Errors only, 2 = Normal, 3 = Verbose
const uint16_t DBG_THROTTLE_MS[4] = {0, 500, 1000, 3000}; // Minimum delay between same-level prints
uint32_t dbgLastPrint[4] = {0, 0, 0, 0};                  // timestamp to throttle serial prints

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
// 🧩 SECTION: PIN DEFINITIONS
// ============================================================

// --- Relay Control outputs (6) ---
#define OUT_COUNT 6
// --- Relays output (6) ---
const uint8_t OUT_PINS[OUT_COUNT] = {2, 3, 4, 5, 6, 7};

// --- Feedback inputs (7) ---
#if DEBUG_SERIAL
// Keep D0, D1 free for Serial debugging
#define IN_COUNT 5
const uint8_t IN_PINS[IN_COUNT] = {A1, A2, A3, A4, A5};
#else
// Use D0, D1 as inputs when not debugging
const uint8_t IN_COUNT = 7;
const uint8_t IN_PINS[IN_COUNT] = {A1, A2, A3, A4, A5, 1, 0};
#endif

// --- Extra analog input (optional) ---
#define EXTRA_INPUT = A6; // Analog input with 10 kΩ pull-up, threshold <200 = pressed

// --- Pushbutton (Cycle Station) ---
#define BTN_PIN A7 // Analog-only button (10 kΩ pull-up to +5 V, button → GND)
// --- W5500 Ethernet ---
#define ETH_CS 10
#define ETH_RST A0 // Same pin as SEED_PIN
// SPI: D11 (MOSI), D12 (MISO), D13 (SCK)

// ============================================================
// 모 SECTION: Ethernet + UDP Setup
// ============================================================

// -------------------- STATE --------------------
uint8_t STATION_ID = 0; // Default if EEPROM empty
uint8_t lastFeedbackBits = 0;

// -------------------- NETWORK --------------------
byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0x02, 0x10};
IPAddress ipMain(192, 168, 1, 1); // Main controller IP
IPAddress ip(192, 168, 1, 11);    // Placeholder, will be recomputed
const uint16_t UDP_PORT = 8888;
EthernetUDP Udp;

EthernetLinkStatus linkStatus;
static bool linkIsUp = true;

// -------------------- NETWORK ID HANDLING --------------------
uint8_t pendingID = 0;                   // Temporary ID shown while cycling
uint32_t lastButtonTime = 0;             // Timestamp of last button press
const uint16_t RECONFIG_DELAY_MS = 1500; // Wait 1.5 s after last press to apply
bool reconfigPending = false;            // True when waiting to apply new ID

// -------------------- TIMING --------------------

const uint16_t HEARTBEAT_MS = 500;
const uint16_t CMD_WATCHDOG_MS = 1000;
uint32_t tHeartbeat = 0;
uint32_t lastCmdMs = 0;

// --- Feedback transmit state tracking ---
bool firstFeedbackSent = false; // Have we sent at least one feedback since last link-up?
bool lastLinkState = false;     // Was Ethernet.linkStatus() == LinkON last heartbeat?

// -------------------- DISPLAY SEGMENTS --------------------
#if HAS_TM1637
// Segments for E, r, and blank (bits: 0b0GFEDCBA)
const uint8_t SEGMENT_E = 0b01111001;
const uint8_t SEGMENT_r = 0b01010000;
const uint8_t SEGMENT_BLANK = 0x00;

// Pre-build "ERRx" template (last char replaced with station number)
uint8_t errDisplay[4] = {SEGMENT_E, SEGMENT_r, SEGMENT_r, 0};

// Segments for L, I, n, k
const uint8_t SEGMENT_L = 0b00111000;
const uint8_t SEGMENT_I = 0b00000110;
const uint8_t SEGMENT_n = 0b01010100;
const uint8_t SEGMENT_K = 0b01110101;

// Pre-build "LInk" template (last char replaced with station number)
uint8_t linkDisplay[4] = {SEGMENT_L, SEGMENT_I, SEGMENT_n, SEGMENT_K};

#endif

// -------------------- UTILITIES --------------------
void ethernetResetPulse()
{
  pinMode(ETH_RST, OUTPUT);
  digitalWrite(ETH_RST, LOW);
  delay(10);
  digitalWrite(ETH_RST, HIGH);
  delay(100);
}

uint8_t xorChecksum(const uint8_t *data, uint8_t len)
{
  uint8_t c = 0;
  for (uint8_t i = 0; i < len; i++)
    c ^= data[i];
  return c;
}

bool readAnalogFeedbackA6()
{
  // Read the analog voltage (10-bit: 0–1023)
  int val = analogRead(A6);
  // Pull-up wiring → pressed/ON ≈ 0, released/OFF ≈ 1023
  // Threshold chosen for noise immunity
  return (val < 200); // true = ON / HIGH signal
}

// ============================================================
// 🖥 SECTION: DISPLAY CONTROL
// ============================================================
enum DisplayMode
{
  DISP_NORMAL,    // show station number + colon heartbeat
  DISP_ERROR,     // show "ErrX" blinking
  DISP_LINK,      // show "LInk" blinking
  DISP_SCROLLING, // 👈 new mode for quick station cycling
  DISP_NETCFG,    // 🚀 new: blinking number during network reconfig
  DISP_VEGAS      // startup LED test animation

};

DisplayMode displayMode = DISP_NORMAL;
bool displayFlash = false; // blink toggle for ERR
uint32_t lastDisplayBlinkMs = 0;
const uint16_t DISPLAY_BLINK_MS = 1000; // 1s blink interval
const uint16_t NETCFG_BLINK_MS = 250;   // ⚡ fast blink for network reconfig
uint32_t scrollDisplayHoldUntil = 0;

// Track if we have Ethernet link & valid commands
bool ethernetLinkOK = false;
bool lastCmdRecent = true;

// --- Unified Display Function ---
void updateDisplay(uint32_t now)
{
  // TEST TEST TEST TEST
  static DisplayMode lastMode = DISP_NORMAL;
  if (lastMode != displayMode)
  {
    Serial.print(F("[DISP] Mode change: "));
    Serial.println(displayMode);
    lastMode = displayMode;
  }
  // TEST TEST TEST TEST
#if HAS_TM1637

  // ============================================================
  // 🟩 PRIORITY OVERRIDE: Show pending station scroll number
  // ============================================================
  static int lastShownScrollID = -1;
  static uint32_t lastScrollUpdate = 0;
  const uint16_t SCROLL_UPDATE_INTERVAL = 200; // ms, prevents flicker

  if(reconfigPending)
  {
    static int lastShownScrollID = -1;
    static uint32_t lastScrollUpdate = 0;
    const uint16_t SCROLL_UPDATE_INTERVAL = 200; // ms, prevents flicker

    if (pendingID != lastShownScrollID || (millis() - lastScrollUpdate) > SCROLL_UPDATE_INTERVAL)
    {
      lastShownScrollID = pendingID;
      lastScrollUpdate = millis();

#if HAS_TM1637
      // 🔹 Clear only once per update (so digits to the right reset cleanly)
      display.clear();
      // 🔹 Show leftmost digit only
      display.showNumberDecEx(pendingID, 0, false, 1, 0);
#endif
    }

    return; // Skip normal updates while scrolling through stations
  }
  // -----------------------------------------------------------

  // Blink timer
  uint16_t blinkInterval = DISPLAY_BLINK_MS;
  if (displayMode == DISP_NETCFG)
    blinkInterval = NETCFG_BLINK_MS; // ⚡ faster during network config

  if (now - lastDisplayBlinkMs >= blinkInterval)
  {
    lastDisplayBlinkMs = now;
    displayFlash = !displayFlash;
  }

  if (displayMode == DISP_NETCFG)
    blinkInterval = NETCFG_BLINK_MS; // faster during network reconfig

  if (now - lastDisplayBlinkMs >= blinkInterval)
  {
    lastDisplayBlinkMs = now;
    displayFlash = !displayFlash;
  }

  static bool colonFlash = false;
  static uint32_t lastColonMs = 0;
  const uint16_t COLON_INTERVAL = 1000; // toggle every 1 s

  if (displayMode == DISP_NORMAL && now - lastColonMs >= COLON_INTERVAL)
  {
    colonFlash = !colonFlash;
    lastColonMs = now;
  }

  switch (displayMode)
  {
  case DISP_NORMAL:
    display.showNumberDecEx(STATION_ID, colonFlash ? 0b01000000 : 0x00, true);
    break;

  case DISP_NETCFG:
  {
    // TEST TEST TEST TEST
    Serial.println(F("[DISP] Switched to NETCFG mode"));
    delay(1000);
    // TEST TEST TEST TEST

    // 🚀 Network reconfiguration visual feedback
    // Blink the station number rapidly with the colon alternating
    if (displayFlash)
    {
      display.showNumberDecEx(STATION_ID, 0b01000000, true); // show number + colon
    }
    else
    {
      display.clear(); // blank screen
    }
    break;
  }

  case DISP_ERROR:
  {
    // Flash between "ErrX" and blank (no colon)
    uint8_t errDisplay[4] = {0b01111001, 0b01010000, 0b01010000, display.encodeDigit(STATION_ID)};
    if (displayFlash)
    {
      display.setSegments(errDisplay);
    }
    else
    {
      uint8_t blank[4] = {0x00, 0x00, 0x00, errDisplay[3]};
      display.setSegments(blank);
    }
    break;
  }

  case DISP_LINK:
    // Blink "LInK" slowly every second
    if (displayFlash)
    {
      display.setSegments(linkDisplay);
    }
    else
    {
      uint8_t blank[4] = {0, 0, 0, 0};
      display.setSegments(blank);
    }
    break;

  case DISP_VEGAS:
    // Do nothing here — handled in startup animation
    break;
  }
#endif
}

// ============================================================
// 🌐 SECTION: NETWORK RECONFIGURATION
// ============================================================
void reconfigureNetwork(bool fullReset = false)
{

  if (fullReset)
  {
    ethernetResetPulse(); // ✅ Only if we want a full clean restart
    delay(200);
  }

  ip = IPAddress(192, 168, 1, 10 + STATION_ID);
  mac[5] = 0x10 + STATION_ID;

  Ethernet.begin(mac, ip);
  Udp.begin(UDP_PORT);

#if DEBUG_SERIAL
  Serial.print(F("[NET] Network reconfigured at "));
  Serial.println(millis());
  Serial.print(F("IP: "));
  Serial.println(ip);
  Serial.print(F("MAC: ...:"));
  Serial.println(mac[5], HEX);
#endif

  // Wait for link to come back up
  uint32_t start = millis();
  while (Ethernet.linkStatus() != LinkON && millis() - start < 5000)
  {
    delay(250);
#if DEBUG_SERIAL
    Serial.print(F("."));
#endif
  }

#if DEBUG_SERIAL
  if (Ethernet.linkStatus() == LinkON)
    Serial.println(F("\n[NET] Link restored"));
  else
    Serial.println(F("\n[NET] Link still down (timeout)"));
#endif

  tHeartbeat = millis() - HEARTBEAT_MS; // force immediate heartbeat

#if HAS_TM1637
  // back to normal mode when link is up
  if (Ethernet.linkStatus() == LinkON)
    displayMode = DISP_NORMAL;
  else
    displayMode = DISP_LINK;
#endif
}

// ============================================================
// 🖥 SECTION: Button & Display System / EEPROM Station ID Handlers
// ============================================================

void loadStationID()
{
  uint8_t id = EEPROM.read(0);
  if (id > 5)
    id = 0; // only allow 0–5
  STATION_ID = id;
}

void saveStationID(uint8_t id)
{
  if (EEPROM.read(0) != id)
    EEPROM.update(0, id);
}

#if HAS_TM1637
void showStationID()
{
  display.clear();
  display.showNumberDec(STATION_ID, false); // no colon, steady number
}

void showStationID_Left()
{
  display.clear();
  display.showNumberDecEx(STATION_ID, 0, false, 1, 0); // one digit at pos 0 (leftmost)
}

void showStationID_Right()
{
  display.clear();
  display.showNumberDecEx(STATION_ID, 0, false, 1, 3); // one digit at pos 3 (rightmost)
}
#endif

// ------------------------------------------------------------------------
// ------------------------------------------------------------------------
// ------------------------------------------------------------------------

void checkButton()
{
  static bool buttonPressed = false;
  static uint32_t lastChangeTime = 0;
  const uint16_t debounceDelay = 50; // ms
  const int threshold = 200;         // analog level for "pressed"
  uint32_t now = millis();

  int analogValue = analogRead(BTN_PIN);
  bool pressed = (analogValue < threshold);

  // --- Debounce logic ---
  static bool stableState = false;
  static bool lastReading = false;

  if (pressed != lastReading)
  {
    lastChangeTime = now;
  }

  if ((now - lastChangeTime) > debounceDelay)
  {
    if (pressed != stableState)
    {
      stableState = pressed;

      if (stableState)
      {
        // ✅ Button press detected
        pendingID++;
        if (pendingID > 5)
          pendingID = 0;

#if HAS_TM1637
        displayMode = DISP_SCROLLING;             // 👈 tell display manager we’re in scroll mode
        scrollDisplayHoldUntil = millis() + 1000; // keep scrolling display visible for 1 s
#endif

#if DEBUG_SERIAL
        Serial.print(F("[BTN] Press detected. New pendingID="));
        Serial.println(pendingID);
#endif

        lastButtonTime = now;
        reconfigPending = true;
      }
    }
  }

  lastReading = pressed;

  // --- Apply after idle delay (1.5 s) ---
  if (reconfigPending && (now - lastButtonTime >= RECONFIG_DELAY_MS))
  {
    reconfigPending = false;

    if (pendingID != STATION_ID)
    {
#if DEBUG_SERIAL
      Serial.print(F("[NET] Applying new Station ID="));
      Serial.println(pendingID);
#endif

      STATION_ID = pendingID;
      saveStationID(STATION_ID);

#if HAS_TM1637
      // Move number to right to confirm
      display.clear();
      display.showNumberDecEx(STATION_ID, 0, false, 1, 3);
#endif

      reconfigureNetwork(true);
    }
  }
}

// ------------------------------------------------------------------------
// ------------------------------------------------------------------------
// ------------------------------------------------------------------------
// void checkButton()
// {
//   static uint32_t lastPress = 0;
//   static bool pressed = false;

//   // Read analog input
//   int val = analogRead(BTN_PIN);
//   bool isPressed = (val < 200); // threshold for pressed

//   if (!pressed && isPressed && millis() - lastPress > 150)
//   {
//     lastPress = millis();
//     pressed = true;

//     // Instantly cycle station ID (fast user response)
//     STATION_ID++;
//     if (STATION_ID > 5)
//       STATION_ID = 0;

//     saveStationID(STATION_ID);

// #if HAS_TM1637
//     showStationID_Left();
//     displayMode = DISP_NORMAL;
// #endif

// #if DEBUG_SERIAL
//     Serial.print(F("[BTN] Clicked at "));
//     Serial.println(millis());
//     Serial.print(F("[BTN] Station ID → "));
//     Serial.println(STATION_ID);
// #endif

//     // Record time of last button activity
//     lastButtonActivity = millis();

//     // Flag pending reconfiguration — handled later in loop()
//     pendingReconfig = true;
//   }
//   else if (!isPressed)
//   {
//     pressed = false;
//   }
// }

void vegasMode()
{
#if HAS_TM1637
  display.setBrightness(0x0F);
  // Show colon and countdown from 9 to 0
  for (int n = 9; n >= 0; n--)
  {
    display.showNumberDecEx(n * 1111, 0b01000000, true); // show colon + number
    delay(250);
  }
  display.showNumberDec(0, false);
  delay(300);
  display.clear();
#endif
}

// ============================================================
// ƒ SECTION: Other Functions
// ============================================================

// -----------------------
void applyBitfieldLSB(uint8_t bits)
{
  for (uint8_t i = 0; i < OUT_COUNT; i++)
  {
    bool on = (bits & (1u << i));
    digitalWrite(OUT_PINS[i], on ? HIGH : LOW);
    // NOTE: If your relay modules are active-LOW, uncomment this line instead:
    // digitalWrite(OUT_PINS[i], on ? LOW : HIGH);
  }

  DBG(4,
      Serial.print(F("[OUT] bits="));
      Serial.println(bits, BIN););
}

// -------------------------- Setup -----------------------------------
void setup()
{
#if DEBUG_SERIAL
  Serial.begin(115200);
  while (!Serial)
  {
  }
  Serial.print(F("[BOOT] Firmware Version: "));
  Serial.println(FIRMWARE_VERSION);
  Serial.println(F("\n[BOOT] Station starting..."));
#endif

  // --- Random seed and Ethernet reset pin reuse ---
  randomSeed(analogRead(ETH_RST) ^ micros());

  // A7 is analog-only on Nano; internal pull-up cannot be enabled.
  // Use external 10k pull-up to +5V (as you wired).
  // pinMode(BTN_PIN, INPUT_PULLUP); // no effect on A7
  pinMode(BTN_PIN, INPUT); // NOTE: A7 is analog-only; pinMode() has no effect. Button read via analogRead(A7).

  for (uint8_t i = 0; i < OUT_COUNT; i++)
  {
    pinMode(OUT_PINS[i], OUTPUT);
    digitalWrite(OUT_PINS[i], LOW);
  }

  for (uint8_t i = 0; i < IN_COUNT; i++)
    pinMode(IN_PINS[i], INPUT_PULLUP);

  loadStationID(); // ensure STATION_ID is valid first

  pendingID = STATION_ID; // Start pendingID as current

// Display settings
#if HAS_TM1637
  display.setBrightness(0x0F);
  if (ENABLE_VEGAS_MODE)
  {
    vegasMode(); // Run the TM1637 test sequence
    displayMode = DISP_NORMAL;
  }

  showStationID();
#endif

  ip = IPAddress(192, 168, 1, 10 + STATION_ID); // Compute IP dynamically from Station ID
  mac[5] = 0x10 + STATION_ID;                   // make last byte unique

  // turn A0 into a digital output for RESET and pulse it
  pinMode(ETH_RST, OUTPUT);
  digitalWrite(ETH_RST, LOW);
  delay(10);
  digitalWrite(ETH_RST, HIGH); // keep high after reset pulse
  delay(100);

  // SPI + CS safety
  pinMode(10, OUTPUT);
  digitalWrite(10, HIGH); // deselect W5500 before init

  Ethernet.init(ETH_CS);
  ethernetResetPulse();
  Ethernet.begin(mac, ip);
  // delay(100);
  Udp.begin(UDP_PORT);
  delay(500);

  EthernetLinkStatus linkStatus = Ethernet.linkStatus();
  if (linkStatus != LinkON)
  {
#if DEBUG_SERIAL
    Serial.println(F("[NET] Link not detected, retrying init..."));
#endif
    delay(1000);
    ethernetResetPulse();
    Ethernet.begin(mac, ip);
    // delay(100);
    Udp.begin(UDP_PORT);
    delay(500);
  }

#if DEBUG_SERIAL
  if (Ethernet.linkStatus() == LinkON)
    Serial.println(F("[NET] Ethernet link OK"));
  else
    Serial.println(F("[NET] Link still down after retry"));
#endif

  uint32_t now = millis();
  lastCmdMs = now;
  tHeartbeat = now;

#if DEBUG_SERIAL
  Serial.print(F("[NET] IP="));
  Serial.println(ip);
#endif
}

// -------------------------- Loop ------------------------------------
void loop()
{

  uint32_t now = millis();
  int size = Udp.parsePacket();

  // 1️⃣ Handle button for station cycling
  checkButton();

  // 2️⃣ Check link state
  // -------------------------------------------------------------
  // 🧩 Ethernet link supervision
  // -------------------------------------------------------------
  EthernetLinkStatus current = Ethernet.linkStatus();
  if (current != LinkON && linkIsUp)
  {
    linkIsUp = false;
    firstFeedbackSent = false; // ✅ Force resend next time link is restored
#if HAS_TM1637
    displayMode = DISP_LINK;
#endif
#if DEBUG_SERIAL
    Serial.println(F("[NET] Link DOWN — showing LInK"));
#endif
  }
  else if (current == LinkON && !linkIsUp)
  {
    linkIsUp = true;
#if HAS_TM1637
    displayMode = DISP_NORMAL;
#endif
#if DEBUG_SERIAL
    Serial.println(F("[NET] Link restored — returning to normal display"));
#endif
  }

  // 3️⃣ Parse UDP packets (only if link is up
  // ============================================================
  // 📥 SECTION: UDP Command Receiver
  // ============================================================

  if (size)
  {
    uint8_t buf[16];
    int n = Udp.read(buf, sizeof(buf));
    if (n >= 5 && buf[0] == 0xAA)
    {
      uint8_t id = buf[1];
      uint8_t cmd = buf[2];
      uint8_t dat = buf[3];
      uint8_t cks = buf[4];
      bool ok = (xorChecksum(buf, 4) == cks) && (id == STATION_ID) && (cmd == 0x01);

      // 🧩 Diagnostic printout for every command frame
      DBG(4,
          Serial.print(F("[RX←MAIN] CMD id="));
          Serial.print(id);
          Serial.print(F(" cmd="));
          Serial.print(cmd, HEX);
          Serial.print(F(" data="));
          Serial.print(dat, BIN);
          Serial.print(F(" cks="));
          Serial.print(cks, HEX);
          Serial.print(F(" ok="));
          Serial.println(ok ? "Y" : "N"););

      if (ok)
      {
        applyBitfieldLSB(dat);
        lastCmdMs = now; // ✅ reset timer so watchdog doesn’t trigger
        lastCmdRecent = true;

#if HAS_TM1637
        displayMode = DISP_NORMAL;
#endif
      }
    }

    // === 🧩 NEW: Feedback-request handler (0xAD) ===
    else if (n >= 5 && buf[0] == 0xAD)
    {
      uint8_t id = buf[1];
      if (id == STATION_ID || id == 255) // 255 = broadcast to all
      {
        Serial.print("millis(): ");
        Serial.println(millis());
        Serial.print(F("[RX←MAIN] Feedback request received for station at "));
        Serial.println(id == 255 ? STATION_ID : id);

        // Force immediate feedback resend
        firstFeedbackSent = false;
      }
    }

    else
    {
      DBG(1, Serial.println(F("[RX←MAIN] ❌ Invalid command or checksum mismatch")));
    }
  }

  // 4️⃣ Heartbeat
  // ============================================================
  // 🙋🏻‍♂️ SECTION: Heartbeat + Feedback TX
  // ============================================================

  if (now - tHeartbeat >= HEARTBEAT_MS)
  {
    // Add small random jitter (±50 ms)
    int16_t jitter = random(-50, 51);         // Random offset in milliseconds
    tHeartbeat = now + HEARTBEAT_MS + jitter; // Schedule next send slightly offset

    uint8_t hb[4];
    hb[0] = 0xAB;
    hb[1] = STATION_ID;
    hb[2] = 0x00;
    hb[3] = xorChecksum(hb, 3);

    Udp.beginPacket(ipMain, UDP_PORT);
    Udp.write(hb, 4);
    Udp.endPacket();

    DBG(4, Serial.print(F("[TX→MAIN] HB ")); for (uint8_t i = 0; i < 4; i++) {
        if (hb[i] < 0x10) Serial.print('0');
        Serial.print(hb[i], HEX);
        Serial.print(' '); } Serial.print(F(" | Station ")); Serial.println(STATION_ID););

    // ============================================================
    // 📤 FEEDBACK TRANSMISSION — On change OR when becoming online
    // ============================================================

    uint8_t feedbackBits = 0;
    for (uint8_t i = 0; i < IN_COUNT; i++)
    {
      bool active = false;
      if (IN_PINS[i] == A6)
      {
        active = (analogRead(A6) < 200); // analog threshold
      }
      else
      {
        active = (digitalRead(IN_PINS[i]) == LOW); // active-low logic
      }
      if (active)
        feedbackBits |= (1 << i);
    }

    // ---- FEEDBACK SEND DECISION ----
    bool changed = (feedbackBits != lastFeedbackBits);
    bool linkNow = (Ethernet.linkStatus() == LinkON);
    bool becameOnline = (linkNow && !lastLinkState);
    bool force = (!firstFeedbackSent) || becameOnline;

    if (changed || force)
    {
      lastFeedbackBits = feedbackBits;

      // 🧠 Invert all bits (1→0, 0→1)
      uint8_t invertedBits = ~feedbackBits;

      uint8_t fb[5];
      fb[0] = 0xAC;
      fb[1] = STATION_ID;
      fb[2] = invertedBits;
      fb[3] = 0x00;
      fb[4] = fb[0] ^ fb[1] ^ fb[2] ^ fb[3];

      Udp.beginPacket(ipMain, UDP_PORT);
      Udp.write(fb, 5);
      Udp.endPacket();

      firstFeedbackSent = true;
      DBG(1,
          Serial.print(F("[FB] Sent bits="));
          Serial.println(invertedBits, BIN););
    }

    lastLinkState = linkNow;
  }

  // 5️⃣ Watchdog (only if link is up)
  // ----- Command Watchdog (Passive mode with ERR display) ----
  if (linkIsUp && (uint32_t)(now - lastCmdMs) > CMD_WATCHDOG_MS)
  {
    // We only want to do the "we lost the main" transition once per outage.
    if (lastCmdRecent)
    {
      lastCmdRecent = false;

      // 🔄 Force a full feedback resend on next heartbeat
      // (Main likely rebooted / lost state, so we re-announce ourselves)
      firstFeedbackSent = false;

      DBG(1,
          Serial.println(F("[WDG] Main not commanding. Forcing next feedback as FULL RESYNC.")););
    }

#if HAS_TM1637
    displayMode = DISP_ERROR; // switch to blinking "Err"
#endif
  }
  else
  {
    // If we're getting commands on time, keep flag true
    if ((uint32_t)(now - lastCmdMs) <= CMD_WATCHDOG_MS)
    {
      lastCmdRecent = true;
#if HAS_TM1637
      // only drop back to normal if link is actually good
      if (linkIsUp)
        displayMode = DISP_NORMAL;
#endif
    }

    //     DBG(1,
    //         Serial.println(F("[WDG] No command received — showing ERR on display.")););
    //     lastCmdRecent = false;
    // #if HAS_TM1637
    //     displayMode = DISP_ERROR; // switch to error blink
    // #endif
  }

  // --- Update Display Once per loop ---
#if HAS_TM1637
  updateDisplay(now);
#endif

} // End of loop