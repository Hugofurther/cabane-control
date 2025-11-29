// -------------------- SYSTEM DEFINES --------------------
#define FIRMWARE_VERSION "v1.0-RebuildStep1"
#define HAS_TM1637 1        // Set to true when a display is connected
#define ENABLE_VEGAS_MODE 1 // Set false to skip startup LED
#define DEBUG_SERIAL 1      // for the else clauses
#define DEBUG_LEVEL 3       // 0 = Off, 1 =

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
#include <avr/wdt.h>

#if HAS_TM1637
#include <TM1637Display.h>
const uint8_t CLK_PIN = 8;
const uint8_t DIO_PIN = 9;
TM1637Display display(CLK_PIN, DIO_PIN);
#endif

// ============================================================
// 🚧 SECTION: DEBUG CONFIG
// ============================================================

// Limit how often serial debug lines are printed
// ---------------- DEBUG CONFIG ----------------
// Errors only, 2 = Normal, 3 = Verbose
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
#define IN_COUNT 7
const uint8_t IN_PINS[IN_COUNT] = {A1, A2, A3, A4, A5, 0, 1};
#endif

// --- Extra analog input (optional) ---
// #define EXTRA_INPUT = A6; // Analog input with 10 kΩ pull-up, threshold <200 = pressed

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
IPAddress ipMain(192, 168, 1, 220); // UPDATED: Main controller is .220
IPAddress ip(192, 168, 1, 211);     // Placeholder, will be recomputed
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
// ============================================================
// 🔧 ROBUST ETHERNET INITIALIZATION (Nano Version)
// ============================================================

void ethernetResetPulse()
{
  // Safety: Ensure SS/CS is high to prevent SPI bus contention during reset
  pinMode(ETH_CS, OUTPUT);
  digitalWrite(ETH_CS, HIGH);

  // Long, Stable Reset Sequence (Matches Main Controller)
  pinMode(ETH_RST, OUTPUT);
  digitalWrite(ETH_RST, LOW);
  delay(200);
  digitalWrite(ETH_RST, HIGH);
  delay(800);
}

// Unified initialization function
// input: fullReset -> if true, performs physical hardware reset + manual handshake
//                   -> if false, just reconfigures library IP (soft restart)
void initEthernet(bool fullReset)
{
  if (fullReset)
  {
    Serial.println(F("[NET] Hardware Init (Hybrid Mode)..."));

    // 1. MANUAL SPI START
    SPI.begin();

    // 2. HARD RESET
    ethernetResetPulse();

    // 3. MANUAL HANDSHAKE (Trust Verify)
    // Talk to the chip manually to ensure it's awake
    SPI.beginTransaction(SPISettings(8000000, MSBFIRST, SPI_MODE0));
    digitalWrite(ETH_CS, LOW);
    SPI.transfer(0x00);
    SPI.transfer(0x39);
    SPI.transfer(0x00);
    byte version = SPI.transfer(0x00);
    digitalWrite(ETH_CS, HIGH);
    SPI.endTransaction();

    if (version == 0x04)
    {
      Serial.println(F("[NET] Manual Handshake: SUCCESS"));
    }
    else
    {
      Serial.print(F("[NET] WARNING: Handshake read 0x"));
      Serial.println(version, HEX);
    }
  }

  // 4. FORCE LIBRARY START
  // We skip hardwareStatus() check because it can be unreliable
  Ethernet.init(ETH_CS);
  Ethernet.begin(mac, ip);
  Udp.begin(UDP_PORT);

  // 5. Configure Retries
  Ethernet.setRetransmissionCount(1);
  Ethernet.setRetransmissionTimeout(200);

  // 6. Verify
  IPAddress local = Ethernet.localIP();
  if (local[0] == 0 || local[0] == 255)
  {
    Serial.println(F("[NET] ERROR: Failed to configure IP."));
  }
  else
  {
    Serial.print(F("[NET] Ready. IP: "));
    Serial.println(local);
  }
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

  if (reconfigPending)
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
// 🟨 FUNCTION: IP Claim Handshake with Main Controller
// ============================================================
bool requestIPClaim(uint8_t id)
{
  // Build claim packet [0xA9, id, 0x01, checksum]
  uint8_t claim[4] = {0xA9, id, 0x01, 0xA9 ^ id ^ 0x01};

  // Send claim to Main
  Udp.beginPacket(ipMain, UDP_PORT);
  Udp.write(claim, 4);
  Udp.endPacket();

#if DEBUG_SERIAL
  Serial.print(F("[CLAIM] Sent ID claim for "));
  Serial.println(id);
#endif

  // Wait briefly for Main’s reply
  uint32_t start = millis();
  while (millis() - start < 500) // 0.5-second timeout
  {
    int size = Udp.parsePacket();
    if (size >= 4)
    {
      uint8_t buf[8];
      Udp.read(buf, sizeof(buf));

      if (buf[0] == 0xAA && buf[1] == id)
      {
        uint8_t result = buf[2];
        if (result == 0x00)
        {
#if DEBUG_SERIAL
          Serial.println(F("[CLAIM] Approved by Main."));
#endif
          return true; // ID available
        }
        else if (result == 0xFE)
        {
#if DEBUG_SERIAL
          Serial.println(F("[CLAIM] Rejected — ID already in use."));
#endif
          return false; // ID conflict
        }
      }
    }
  }

#if DEBUG_SERIAL
  Serial.println(F("[CLAIM] No reply — assuming OK (Main offline)."));
#endif
  return true; // default OK if no reply
}

// ============================================================
// 🟢 FUNCTION: checkStationIDConflict()
// PURPOSE : Sends a handshake to Main (0xAE) and interprets reply.
//           Returns true only if Main explicitly reports a conflict.
//           Returns false if ID OK or no reply (Main offline).
// ============================================================
bool checkStationIDConflict(uint8_t currentID)
{
  uint8_t buf[3] = {0xAE, currentID, (uint8_t)(0xAE ^ currentID)}; // handshake request
  Udp.beginPacket(ipMain, UDP_PORT);
  Udp.write(buf, 3);
  Udp.endPacket();

  uint32_t tStart = millis();
  while (millis() - tStart < 1000) // wait up to 1s for reply
  {
    int size = Udp.parsePacket();
    if (size >= 3)
    {
      uint8_t reply[3];
      Udp.read(reply, 3);

      // Expect [0xAF, id, status^cks]
      if (reply[0] == 0xAF && reply[1] == currentID)
      {
        uint8_t status = reply[2] ^ (reply[0] ^ reply[1]);
        if (status == 0xFF)
        {
          Serial.println(F("[HS] Conflict reply received"));
          return true; // confirmed conflict
        }
        else
        {
          Serial.println(F("[HS] ID accepted by main"));
          return false; // explicitly approved
        }
      }
    }
  }

  // If we reach here → no reply from main (offline)
  Serial.println(F("[HS] No reply from main (assuming main offline, ID OK)"));
  return false;
}

// ============================================================
// 🌐 ROBUST NETWORK RECONFIGURATION + ACTIVE PING SUPPORT
// ============================================================
void reconfigureNetwork(bool fullReset)
{
  // 1. Setup initial credentials
  // UPDATED: IP is now 210 + StationID (e.g., ID 0 = .210, ID 1 = .211)
  ip = IPAddress(192, 168, 1, 210 + STATION_ID);
  
  // MAC Last Byte: 0x10 + ID. We can keep this logic, it doesn't strictly need to match IP.
  // 0x10 = 16. So ID 0 has MAC ending in :10. This is fine and avoids conflicts.
  mac[5] = 0x10 + STATION_ID; 

  // 2. Init Hardware
  initEthernet(fullReset);

  // 3. Link Wait
  if (fullReset)
  {
    uint32_t start = millis();
    while (Ethernet.linkStatus() != LinkON && millis() - start < 3000)
    {
      delay(100);
      wdt_reset();
    }
  }

  // 4. FAST HANDSHAKE
  // We rely on the Main Controller's "Active Ping" to distinguish
  // between a Ghost Session (my old self) and a Real Conflict.

  if (Ethernet.linkStatus() == LinkON)
  {
    // Try the current ID first
    bool conflict = checkStationIDConflict(STATION_ID);

    if (!conflict)
    {
// Success! Main Controller verified we are the only one.
#if DEBUG_SERIAL
      Serial.println(F("[NET] ID Accepted."));
#endif
    }
    else
    {
// Real Conflict detected (Main Controller pinged someone else).
// Search for a new ID.
#if DEBUG_SERIAL
      Serial.println(F("[NET] ID Taken. Searching..."));
#endif

      for (uint8_t offset = 1; offset < 6; offset++)
      {
         uint8_t tryID = (STATION_ID + offset) % 6;
         
         // Temporary IP config for the check
         bool check = checkStationIDConflict(tryID);
         
         if (!check) {
            // Found a free one
            STATION_ID = tryID;
            saveStationID(STATION_ID);
            
            // UPDATED: Apply new Network settings permanently (210 + ID)
            ip = IPAddress(192, 168, 1, 210 + STATION_ID);
            mac[5] = 0x10 + STATION_ID;
            initEthernet(false); // Soft re-init
            
            break; 
         }
         delay(50); wdt_reset();
      }
    }
  }

  // 5. Reset State
  tHeartbeat = millis() - HEARTBEAT_MS;
  lastCmdMs = millis();

#if HAS_TM1637
  displayMode = (Ethernet.linkStatus() == LinkON) ? DISP_NORMAL : DISP_LINK;
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

// ---------- VEGAS MODE ----------

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
  // 1. Disable Watchdog (Nano can get stuck in WDT loops too)
  wdt_disable();

  // 2. Power Settle
  delay(500);

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
  randomSeed(analogRead(A0) ^ micros());

  // --- Pin Setup ---
  // A7 is analog-only on Nano; internal pull-up cannot be enabled.
  // Use external 10k pull-up to +5V (as you wired).
  // pinMode(BTN_PIN, INPUT_PULLUP); // no effect on A7
  pinMode(BTN_PIN, INPUT); // A7 is Analog Input Only

  for (uint8_t i = 0; i < OUT_COUNT; i++)
  {
    pinMode(OUT_PINS[i], OUTPUT);
    digitalWrite(OUT_PINS[i], LOW);
  }

  for (uint8_t i = 0; i < IN_COUNT; i++)
  {
    pinMode(IN_PINS[i], INPUT_PULLUP);
  }

  // --- Load ID ---
  loadStationID();
  pendingID = STATION_ID;

// --- Display Init ---
#if HAS_TM1637
  display.setBrightness(0x0F);
  if (ENABLE_VEGAS_MODE)
  {
    vegasMode();
    displayMode = DISP_NORMAL;
  }
  showStationID();
#endif

  // --- PIN SAFETY (Nano Specific) ---
  // Pin 10 is SS on Nano. It MUST be output for SPI Master.
  // It is also your ETH_CS, so this handles both.
  pinMode(ETH_CS, OUTPUT);
  digitalWrite(ETH_CS, HIGH);

  // --- NETWORK INIT ---
  // This now uses the robust "Hybrid" logic
  reconfigureNetwork(true);

  // --- Watchdog Start ---
  // Only enable if you are using wdt_reset() in the loop
  // wdt_enable(WDTO_4S);
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
    // Run a lightweight reconfigure to ensure ID uniqueness
    delay(250);
    reconfigureNetwork(false);
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
        lastCmdMs = now; 
        lastCmdRecent = true;

        // 🔄 DYNAMIC MASTER HANDOVER
        // If this valid command came from a different IP (e.g., the Pi),
        // switch loyalty to that new IP so feedbacks go to the active controller.
        IPAddress senderIP = Udp.remoteIP();
        if (senderIP != ipMain) {
           ipMain = senderIP;
           DBG(1, Serial.print(F("[NET] Master IP Changed to: ")); Serial.println(ipMain));
        }

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

    // 1. Read Standard Inputs (A1-A5) -> Bits 0, 1, 2, 3, 4
    // We cap at 5 because Bit 5 and 6 are handled by A6 logic
    for (uint8_t i = 0; i < IN_COUNT && i < 5; i++)
    {
      if (digitalRead(IN_PINS[i]) == LOW) // Active Low
        feedbackBits |= (1 << i);
    }

    // 2. Read Multiplexed Inputs on A6 (Replaces D0/D1)
    int valA6 = analogRead(A6);

    // CALIBRATED THRESHOLDS based on your data:
    // Both OFF: 1023
    // Sw 7 Only: 634
    // Sw 6 Only: 572
    // Both ON: 427

    bool sw6_Active = false; // Old D1
    bool sw7_Active = false; // Old D0

    if (valA6 < 850)
    { // If voltage is < 4.1V, something is ON
      if (valA6 < 500)
      {
        // Both ON (~427)
        sw6_Active = true;
        sw7_Active = true;
      }
      else if (valA6 < 605)
      {
        // Switch 6 Only (~572)
        // Range: 500 to 605
        sw6_Active = true;
      }
      else
      {
        // Switch 7 Only (~634)
        // Range: 605 to 850
        sw7_Active = true;
      }
    }

    if (sw6_Active)
      feedbackBits |= (1 << 5); // Bit 5
    if (sw7_Active)
      feedbackBits |= (1 << 6); // Bit 6

    // ---- FEEDBACK SEND DECISION ----
    bool changed = (feedbackBits != lastFeedbackBits);
    bool linkNow = (Ethernet.linkStatus() == LinkON);
    bool becameOnline = (linkNow && !lastLinkState);
    bool force = (!firstFeedbackSent) || becameOnline;

    if (changed || force)
    {
      lastFeedbackBits = feedbackBits;

      // 🧠 Invert all bits (1→0, 0→1) so 0 means ON (active low logic for Main)
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
      DBG(1, Serial.print(F("[FB] Sent bits=")); Serial.println(invertedBits, BIN););
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
    if (displayMode != DISP_NETCFG) // don't override during handshake
      displayMode = DISP_ERROR;     // switch to blinking "Err"
#endif

    // 🧠 Schedule an automatic handshake retry after 5 s of silence
    static uint32_t lastRetryAttempt = 0;
    if (millis() - lastRetryAttempt > 5000)
    {
      lastRetryAttempt = millis();

#if DEBUG_SERIAL
      Serial.println(F("[WDG] Attempting network re-handshake..."));
#endif
      reconfigureNetwork(false); // soft handshake (no full W5500 reset)
    }
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
  }

  // --- Update Display Once per loop ---
#if HAS_TM1637
  updateDisplay(now);
#endif

} // End of loop