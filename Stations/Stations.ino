/*
  Station_Generic_Binary_TM1637.ino
  ======================================================================
  BOARD:   Arduino Nano
  ETHERNET: W5500 module (not Ethernet shield), SPI wiring:
            - MOSI = D11
            - MISO = D12
            - SCK  = D13
            - CS   = D10
            - RST  = D9 or A0 (shared reset/seed)
  PURPOSE:
    • Receive 5-byte command frames from MAIN:
        [0]=0xAA, [1]=stationId (0–5), [2]=0x01 (SET),
        [3]=bitfield (LSB→OUT0), [4]=XOR checksum.
    • Maintain last outputs if MAIN is silent.
    • Send heartbeat every 500 ms: [0xAB,id,0x00,cks].
    • Send feedback frame when input changes:
        [0xAC,id,bits,0x00,cks].
    • TM1637 (optional) + pushbutton (A7) let you select
      station ID (0–5) stored in EEPROM.
  WATCHDOG:
    Keeps last known state (no auto-off).
*/
#define FIRMWARE_VERSION "v1.2.1 FINAL (2025-10-16)"
#define DEBUG_SERIAL true
#define HAS_TM1637 1          // Set to true when a display is connected
const bool ENABLE_VEGAS_MODE = true; // Set false to skip startup LED test

#if HAS_TM1637
  #include <TM1637Display.h>
  const uint8_t CLK_PIN = 8;
  const uint8_t DIO_PIN = 9;
  TM1637Display display(CLK_PIN, DIO_PIN);

  // Segments for E, r, and blank (bits: 0b0GFEDCBA)
  const uint8_t SEGMENT_E = 0b01111001;
  const uint8_t SEGMENT_r = 0b01010000;
  const uint8_t SEGMENT_BLANK = 0x00;

  // Pre-build "ERRx" template (last char replaced with station number)
  uint8_t errDisplay[4] = {SEGMENT_E, SEGMENT_r, SEGMENT_r, 0};
#endif

#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <EEPROM.h>

// ---------------- PIN DEFINITIONS ----------------

// --- Dual-use: seed analog + Ethernet reset ---
const uint8_t SEED_PIN = A0;   // Read once for random seed, then reused as Ethernet reset

// --- Pushbutton (Cycle Station) ---
const uint8_t BTN_PIN = A7;    // Analog-only button (10 kΩ pull-up to +5 V, button → GND)

// --- Extra analog input (optional) ---
const uint8_t EXTRA_INPUT = A6; // Analog input with 10 kΩ pull-up, threshold <200 = pressed

// --- Relay Control outputs (6) ---
const uint8_t OUT_COUNT = 6;
const uint8_t OUT_PINS[OUT_COUNT] = {2, 3, 4, 5, 6, 7};

// --- Feedback inputs (7) ---
#if DEBUG_SERIAL
  // Keep D0, D1 free for Serial debugging
  const uint8_t IN_COUNT = 5;
  const uint8_t IN_PINS[IN_COUNT] = {A1, A2, A3, A4, A5};
#else
  // Use D0, D1 as inputs when not debugging
  const uint8_t IN_COUNT = 7;
  const uint8_t IN_PINS[IN_COUNT] = {A1, A2, A3, A4, A5, 0, 1};
#endif


// --- W5500 Ethernet ---
const uint8_t ETH_CS  = 10;
const uint8_t ETH_RST = A0;   // Same pin as SEED_PIN
// SPI: D11 (MOSI), D12 (MISO), D13 (SCK)

// ------------------- Feedback tracking state --------------------

uint8_t lastFeedbackBits = 0;

// ------------------- Station ID selection system --------------------

uint8_t STATION_ID = 0;              // Default if EEPROM empty
IPAddress ipMain(192,168,1,1);      // Main controller IP

void loadStationID() {
  uint8_t id = EEPROM.read(0);
  if (id > 5) id = 0;   // only allow 0–5
  STATION_ID = id;
}

void saveStationID(uint8_t id) {
  if (EEPROM.read(0) != id) EEPROM.update(0, id);
}

void showStationID() {
  #if HAS_TM1637
    display.clear();
    display.showNumberDec(STATION_ID);
  #endif
}

void checkButton() {
  static uint32_t lastPress = 0;
  static bool pressed = false;

  // --- Startup lockout to prevent accidental cycling ---
  static bool startupLock = true;
  static uint32_t startupTime = millis();
  if (startupLock && millis() - startupTime < 3000) return; // ignore for 3 sec
  startupLock = false;

  int val = analogRead(BTN_PIN);
  bool isPressed = (val < 200);  // threshold for A7 (pull-up to +5V)

  if (!pressed && isPressed && millis() - lastPress > 150) {
    lastPress = millis();
    pressed = true;

    STATION_ID++;
    if (STATION_ID > 5) STATION_ID = 0;
    saveStationID(STATION_ID);
    showStationID();

    #if DEBUG_SERIAL
      Serial.print(F("[BTN] Station ID set to "));
      Serial.println(STATION_ID);
    #endif
  } 
  else if (!isPressed) {
    pressed = false;
  }
}

bool readAnalogFeedbackA6() {
  // Read the analog voltage (10-bit: 0–1023)
  int val = analogRead(A6);
  // Pull-up wiring → pressed/ON ≈ 0, released/OFF ≈ 1023
  // Threshold chosen for noise immunity
  return (val < 200);   // true = ON / HIGH signal
}

void vegasMode() {
  #if HAS_TM1637
    display.setBrightness(0x0F);
    // Show colon and countdown from 9 to 0
    for (int n = 9; n >= 0; n--) {
      display.showNumberDecEx(n * 1111, 0b01000000, true); // show colon + number
      delay(250);
    }
    display.showNumberDec(0, false);
    delay(300);
    display.clear();
  #endif
}

// ------------------- Ethernet configuration --------------------
IPAddress ip(192,168,1,11); // Placeholder, will be recomputed

const uint16_t UDP_PORT = 8888;
EthernetUDP Udp;

const uint16_t HEARTBEAT_MS=500;
const uint16_t CMD_WATCHDOG_MS=1000;
uint32_t tHeartbeat=0, lastCmdMs=0;

// -------------------------- Utilities --------------------------------
void ethernetResetPulse(){
  pinMode(ETH_RST, OUTPUT);
  digitalWrite(ETH_RST, LOW);
  delay(10);
  digitalWrite(ETH_RST, HIGH);
  delay(100);
}

uint8_t xorChecksum(const uint8_t* data, uint8_t len){
  uint8_t c=0; for(uint8_t i=0;i<len;i++) c ^= data[i]; return c;
}


void applyBitfieldLSB(uint8_t bits){
  for(uint8_t i=0; i<OUT_COUNT; i++) {
    bool on = (bits & (1u << i));
    digitalWrite(OUT_PINS[i], on ? HIGH : LOW);
    // NOTE: If your relay modules are active-LOW, uncomment this line instead:
    // digitalWrite(OUT_PINS[i], on ? LOW : HIGH);
  }

  #if DEBUG_SERIAL
  Serial.print(F("[OUT] bits=")); Serial.println(bits, BIN);
  #endif
}

// -------------------------- Setup -----------------------------------
void setup(){
  #if DEBUG_SERIAL
  Serial.begin(115200);
  Serial.print(F("[BOOT] Firmware Version: "));
  Serial.println(FIRMWARE_VERSION);
  while(!Serial){}; Serial.println(F("\n[BOOT] Station starting..."));
  #endif

  // --- Random seed and Ethernet reset pin reuse ---
  randomSeed(analogRead(SEED_PIN) ^ micros());
  pinMode(ETH_RST, OUTPUT);
  digitalWrite(ETH_RST, HIGH);  // keep high after reset pulse

  // A7 is analog-only on Nano; internal pull-up cannot be enabled.
  // Use external 10k pull-up to +5V (as you wired).
  // pinMode(BTN_PIN, INPUT_PULLUP); // no effect on A7
  pinMode(BTN_PIN, INPUT); // NOTE: A7 is analog-only; pinMode() has no effect. Button read via analogRead(A7).

  for (uint8_t i = 0; i < OUT_COUNT; i++) {
    pinMode(OUT_PINS[i], OUTPUT);
    digitalWrite(OUT_PINS[i], LOW);
  }

  for (uint8_t i = 0; i < IN_COUNT; i++)
    pinMode(IN_PINS[i], INPUT_PULLUP);

  // Display settings
  #if HAS_TM1637
    display.setBrightness(0x0F);
    if (ENABLE_VEGAS_MODE){
      vegasMode();          // Run the TM1637 test sequence
    }
  #endif

  byte mac[] = {0xDE,0xAD,0xBE,0xEF,0x02,0x10};
  loadStationID();           // ensure STATION_ID is valid first
  showStationID();
  ip = IPAddress(192,168,1,10 + STATION_ID); // Compute IP dynamically from Station ID
  mac[5] = 0x10 + STATION_ID; // make last byte unique
  
  Ethernet.init(ETH_CS);
  ethernetResetPulse();
  Ethernet.begin(mac, ip);
  delay(100);

  Udp.begin(UDP_PORT);

  delay(500);
  EthernetLinkStatus linkStatus = Ethernet.linkStatus();
  if (linkStatus != LinkON) {
    #if DEBUG_SERIAL
    Serial.println(F("[NET] Link not detected, retrying init..."));
    #endif
    delay(1000);
    ethernetResetPulse();
    Ethernet.begin(mac, ip);
    delay(100);
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

  uint32_t now = millis();
  lastCmdMs  = now;
  tHeartbeat = now;

  #if DEBUG_SERIAL
  Serial.print(F("[NET] IP=")); Serial.println(ip);
  #endif
}

// -------------------------- Loop ------------------------------------
void loop(){
  checkButton();
  uint32_t now = millis();

  int size = Udp.parsePacket();
  if(size){
    uint8_t buf[16];
    int n = Udp.read(buf, sizeof(buf));
    if(n >= 5 && buf[0] == 0xAA){
      uint8_t id  = buf[1];
      uint8_t cmd = buf[2];
      uint8_t dat = buf[3];
      uint8_t cks = buf[4];
      bool ok = (xorChecksum(buf,4) == cks) && (id == STATION_ID) && (cmd == 0x01);
      #if DEBUG_SERIAL
      Serial.print(F("[RX ] id=")); Serial.print(id);
      Serial.print(F(" data=")); Serial.print(dat,BIN);
      Serial.print(F(" ok=")); Serial.println(ok?"Y":"N");
      #endif

      if (ok) {
        applyBitfieldLSB(dat);
        lastCmdMs = now;  // ✅ reset timer so watchdog doesn’t trigger

        #if HAS_TM1637
          // ✅ Clear ERR and show station ID normally again
          display.showNumberDec(STATION_ID);
        #endif
      }
    }
  }

  if (now - tHeartbeat >= HEARTBEAT_MS) {
    // Add small random jitter (±50 ms)
    int16_t jitter = random(-50, 51);   // Random offset in milliseconds     
    tHeartbeat = now + HEARTBEAT_MS + jitter; // Schedule next send slightly offset

    uint8_t hb[4];
    hb[0] = 0xAB;
    hb[1] = STATION_ID;
    hb[2] = 0x00;
    hb[3] = xorChecksum(hb, 3);

    Udp.beginPacket(ipMain, UDP_PORT);
    Udp.write(hb, 4);
    Udp.endPacket();

    #if DEBUG_SERIAL
    Serial.println(F("[TX ] Heartbeat sent"));
    #endif

    uint8_t feedbackBits = 0;
    for (uint8_t i = 0; i < IN_COUNT; i++) {
      bool active = digitalRead(IN_PINS[i]) == HIGH;
      if (active) feedbackBits |= (1 << i);
    }

    // --- Add analog input A6 as next bit ---
    if (readAnalogFeedbackA6()) {
      feedbackBits |= (1 << IN_COUNT);
    }

    // if something changed since last send, transmit now
    if (feedbackBits != lastFeedbackBits) {
      lastFeedbackBits = feedbackBits;

      uint8_t fb[5];
      fb[0] = 0xAC;
      fb[1] = STATION_ID;
      fb[2] = feedbackBits;
      fb[3] = 0x00;
      fb[4] = fb[0] ^ fb[1] ^ fb[2] ^ fb[3];

      Udp.beginPacket(ipMain, UDP_PORT);
      Udp.write(fb, 5);
      Udp.endPacket();

      #if DEBUG_SERIAL
        Serial.print(F("[FB-CHG] Immediate feedback bits: "));
        Serial.println(feedbackBits, BIN);

        // Optional: show A6 analog status too
        Serial.print(F("[FB] A6="));
        Serial.print(readAnalogFeedbackA6());
        Serial.print(F(" bits: "));
        Serial.println(feedbackBits, BIN);
      #endif
    }

    // --- Heartbeat visual pulse (TM1637 optional) + onboard LED ---
    #if HAS_TM1637
      display.showNumberDecEx(STATION_ID, 0b01000000);
    #endif
    showStationID();
  }

  // ---------------- Command Watchdog (Passive mode with ERR display) ----------------
  if ((uint32_t)(now - lastCmdMs) > CMD_WATCHDOG_MS) {
    #if DEBUG_SERIAL
      Serial.println(F("[WDG] No command received — showing ERR on display."));
    #endif

    #if HAS_TM1637
      // Update last digit with current station number
      errDisplay[3] = display.encodeDigit(STATION_ID);

      // Flashing effect every ~400 ms
      static bool flash = false;
      static uint32_t lastFlash = 0;
      if (now - lastFlash > 400) {
        flash = !flash;
        lastFlash = now;
      }

      // Apply flashing ERR + static station number
      if (flash) {
        display.setSegments(errDisplay);
      } else {
        uint8_t blank[4] = {SEGMENT_BLANK, SEGMENT_BLANK, SEGMENT_BLANK, errDisplay[3]};
        display.setSegments(blank);
      }
    #endif
  }

  // #if DEBUG_SERIAL
  //   Diagnostic only: reads pins (A7)
  //   Safe to remove in final build
  //   Serial.print(F("[DIAG] A7="));
  //   Serial.println(digitalRead(A7));
  //   delay(300);
  // #endif
}