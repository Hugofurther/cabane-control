/*
===========================================================
  Main_Controller_Binary_Detailed.ino
  ----------------------------------------------------------
  PURPOSE:
    Acts as the central control unit for up to 6 remote
    Station Controllers (Station 0–5). Each station has its
    own switches (inputs) and paired LEDs (outputs) that 
    visually represent real-time relay and feedback status.

  ----------------------------------------------------------
  OVERVIEW:
    • Reads local switch states for 6 stations.
    • Sends binary status packets to each Station Controller.
    • Receives feedback packets (or heartbeat) confirming
      station connectivity and output relay states.
    • Displays station states on paired Green/Red LEDs.
    • Supports LED signaling for:
        - Boot defaults from EEPROM
        - Network down (Ethernet unplugged)
        - Station offline
        - Station disabled
        - Active feedback state (relay energized / idle)
    • Includes EEPROM persistence for station enable/disable.
      - Saved only when changed.
      - Restored on boot to retain station states.
    • Supports long-press detection on switches for toggling
      station enable/disable or other actions.
    • Includes heartbeat back-off system to prevent flooding.

  ----------------------------------------------------------
  HARDWARE OVERVIEW:
    • Controller: Arduino Mega 2560
    • Ethernet: W5500 module (SPI)
    • EEPROM: internal (1KB)
    • Pins:
        - 21 input switches (station command inputs)
        - 42 output pins for paired LEDs (Green/Red)
        • Total 6 stations:
            ▪ Station 0: 2 inputs, 4 LED outputs
            ▪ Station 1: 6 inputs, 12 LED outputs
            ▪ Station 2: 4 inputs, 8 LED outputs
            ▪ Station 3: 4 inputs, 8 LED outputs
            ▪ Station 4: 3 inputs, 6 LED outputs
            ▪ Station 5: 2 inputs, 4 LED outputs
    • Total: 21 inputs, 42 LED outputs (63 digital pins)
      → Note: Arduino Mega supports only up to pin 69;
        Currently uses onboard pins only (no I/O expander)

  ----------------------------------------------------------
  LED BEHAVIOR SUMMARY:
    • On boot:
        - If EEPROM uninitialized → all stations ENABLED by default.
    • If Ethernet cable unplugged:
        - All station LEDs blink RED at 250 ms (BLINK_INTERVAL_MS).
    • If station offline (no heartbeat):
        - LEDs alternate RED/GREEN at 250 ms per station.
    • If station disabled:
        - All LEDs for that station OFF.
    • When connected & online:
        - Green LED ON when station feedback bit = 1 (relay active).
        - Red LED ON when feedback bit = 0 (relay inactive).
      (Switches never directly control LEDs; all LED states are
       driven by feedback from the Station Controllers.)

  ----------------------------------------------------------
  COMMUNICATION PROTOCOL:
    • UDP messages between Main and Station Controllers.
    • Outgoing binary packet example:
        [0xAA, stationID, 0x01, stateBits, checksum]
    • Incoming heartbeat packet:
        [0xAB, stationID, status, checksum]
    • Incoming feedback packet:
        [0xAC, stationID, bits, status, checksum]
      → Bits correspond to station’s 8 output relays.
    • Heartbeats keep link active and verify station health.
    • Timeouts mark stations as offline if missed > 2000ms.

  ----------------------------------------------------------
  EEPROM BEHAVIOR:
    • On boot:
        - Reads 1 byte per station.
        - 0 = Disabled, 1 = Enabled.
        - If value invalid → defaults to Enabled.
    • During operation:
        - Writes only on change (using EEPROM.update()).

  ----------------------------------------------------------
  LONG PRESS HANDLING:
    • Detects long press per station.
    • Can be used to enable/disable stations manually.
    • Constants:
        - LONGPRESS_MS = 5000 ms (5 seconds)
    • pressStart[] / pressActive[] arrays track timing per station.

  ----------------------------------------------------------
  HEARTBEAT BACK-OFF:
    • Randomized back-off timer for heartbeats.
    • Prevents simultaneous flooding of UDP packets.
    • Uses station-based random intervals.
    • randomSeed() placed on Station Controller (since all A-pins
      are used on the Main Controller).

  ----------------------------------------------------------
  STATUS OVERVIEW:
    - stationEnabled[] → whether station is allowed to run.
    - “stationFeedback[station][bit] → relay ON/OFF feedback from each station (bit 0 = first output).”
    - “Overrides: Station 0 A3 forces main inputs 4, 5, 11, 16 ON; Station 4 A4 forces input 19 ON.”
    - stationFeedback[][] → current relay states from feedback.
    - lastHeartbeatMs[] → last heartbeat timestamp per station.
    - pressStart[] / pressActive[] → long press timers.
    - stationButtonIndex[] → maps switch index per station to IN_PINS.
    - LED_A[] / LED_B[] → paired LED pins (Green/Red).
    - IN_PINS[] → all switch input pins.
    - UDP/IP config → static or DHCP-based (defined elsewhere).

  ----------------------------------------------------------
  KNOWN LIMITATIONS:
    • Mega digital pins 70–88 referenced for future expansion
      but not physically present.
      → I²C GPIO expanders (MCP23017) or LED drivers recommended.
    • Station 4 & 5 hardware defined for future wiring.
    • SPI bus reserved for Ethernet W5500 (no LED driver sharing).
    • Some feedback logic (0xAC) must exist in Station firmware.

  ----------------------------------------------------------
  AUTHOR’S INTENT:
    This sketch is built for diagnostic clarity — every major
    process (I/O read, packet send, packet receive, feedback,
    EEPROM, LED logic) is kept explicit for easy debugging
    and later refactoring once expansion hardware is added.

===========================================================
*/

// -------------------------------------------------------------------
// Compile-time diagnostics flag. Set to true for bench testing to see
// parsed frames, checksums, and state changes over USB Serial Monitor.
// Keep FALSE in production for deterministic timing.
// -------------------------------------------------------------------
#define FIRMWARE_VERSION "v1.2.0 (2025-10-16)"
#define DEBUG_SERIAL true
#define ENABLE_OVERRIDE true

// --------------------------------------------------------------
// Vegas Mode Configuration
// --------------------------------------------------------------
const bool ENABLE_VEGAS_MODE = true;   // Set false to skip startup LED test
const uint16_t VEGAS_DELAY_MS = 60;    // Speed between LEDs (adjust to taste)
const uint8_t VEGAS_FLASHES = 2;       // Number of red/green blinks per station

#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <EEPROM.h>


// --- EEPROM addresses ---
const uint8_t EEPROM_STATION_BASE = 0;   // start address
const uint8_t EEPROM_STATION_COUNT = 6;  // 6 stations total

// ----------------------------- NETWORK ------------------------------
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x10 };

// Fixed IPs per design
IPAddress ipMain(192,168,1,1);  // This Mega
IPAddress ipS0(192,168,1,10);   // Station 0
IPAddress ipS1(192,168,1,11);   // Station 1
IPAddress ipS2(192,168,1,12);   // Station 2
IPAddress ipS3(192,168,1,13);   // Station 3
IPAddress ipS4(192,168,1,14);   // Station 4
IPAddress ipS5(192,168,1,15);   // Station 5

const uint16_t UDP_PORT = 8888;  // UDP port for all nodes

EthernetUDP Udp;                 // Single socket for RX/TX

// W5500 control pins on MEGA
const uint8_t ETH_CS    = 22;    // Chip Select
const uint8_t ETH_RESET = 23;     // Reset pin to W5500

// ----------------------------- I/O MAP ------------------------------
#define NUM_STATIONS   6
#define NUM_INPUTS     21    // switches
#define NUM_LED_PAIRS  21    // pairs of A/B LEDs

// ===== Input Switch Pins (21 total) =====
// Using D2–D21 + D1 (if DEBUG off)
#if DEBUG_SERIAL
  const uint8_t IN_PINS[NUM_INPUTS] = {
    // Station 0 (2)
    2, 3,
    // Station 1 (6)
    4, 5, 6, 7, 8, 9,
    // Station 2 (4)
    10, 11, 12, 13,
    // Station 3 (4)
    14, 15, 16, 17,
    // Station 4 (3)
    18, 19, 20,
    // Station 5 (2)
    21
  };
#else
    const uint8_t IN_PINS[NUM_INPUTS] = {
      // Station 0 (2)
      2, 3,
      // Station 1 (6)
      4, 5, 6, 7, 8, 9,
      // Station 2 (4)
      10, 11, 12, 13,
      // Station 3 (4)
      14, 15, 16, 17,
      // Station 4 (3)
      18, 19, 20,
      // Station 5 (2)
      21,1
    };
#endif



// ===== LED Output Pins (21 pairs = 42 pins) =====
// Each pair = RED (LED_A) + GREEN (LED_B)
//
//   • RED  → LED_A[] = even-numbered pins (D24, D26, D28, … D68)
//   • GREEN → LED_B[] = odd-numbered pins  (D25, D27, D29, … D69)
//
// Relay Logic (displayed via feedback):
//   • GREEN = Relay active (energized) → current flowing
//   • RED   = Relay inactive (open)    → no current flow
//
// This even/odd pairing keeps wiring logical and symmetrical:
//   D24/D25, D26/D27, D28/D29, … D68/D69
//
// Example LED behavior:
//   - relayOn == true  → GREEN ON  (LED_B HIGH, LED_A LOW)
//   - relayOn == false → RED ON    (LED_A HIGH, LED_B LOW)

const uint8_t LED_A[NUM_LED_PAIRS] = {  // 🔴 RED LEDs
  24, 26, 28, 30, 32, 34, 36,
  38, 40, 42, 44, 46, 48, 54,
  56, 58, 60, 62, 64, 66, 68
};

const uint8_t LED_B[NUM_LED_PAIRS] = {  // 🟢 GREEN LEDs
  25, 27, 29, 31, 33, 35, 37,
  39, 41, 43, 45, 47, 49, 55,
  57, 59, 61, 63, 65, 67, 69
};

// ----------------------------- TIMING --------------------------------
const uint16_t DEBOUNCE_MS           = 25;
const uint16_t SEND_INTERVAL_MS      = 50;
const uint16_t HEARTBEAT_TIMEOUT_MS  = 2000;
const uint16_t BLINK_INTERVAL_MS     = 250;

uint32_t lastChangeMs[NUM_INPUTS] = {0};
uint8_t  stableState[NUM_INPUTS]  = {0};
uint8_t  lastRaw[NUM_INPUTS]      = {0};

uint32_t tSend  = 0;
uint32_t tBlink = 0;
bool     blinkPhase = false;

// Heartbeat state
// ===== Station IDs =====
enum { ST0 = 0, ST1, ST2, ST3, ST4, ST5 };

// ===== Station Runtime State =====
uint32_t lastHeartbeatMs[NUM_STATIONS] = {0};
// Show all "online" at startup until proven otherwise
bool stationOffline[NUM_STATIONS] = {false, false, false, false, false, false};
// Station enable flags
bool stationEnabled[NUM_STATIONS] = {false, true, true, true, true, true};
// Station feedback bits (true = output ON at station)
bool stationFeedback[NUM_STATIONS][8] = {false}; // up to 8 outputs per station

// Long-press detection parameters
const uint32_t LONGPRESS_MS = 5000; // 30000 30 seconds
// Track per-station long-press start times and active states
uint32_t pressStart[NUM_STATIONS] = {0};
bool     pressActive[NUM_STATIONS] = {false};

// ----------------------------- BUTTON MAPPING -----------------------------
// Maps each station to the index of its main control button in IN_PINS[]
const uint8_t stationButtonIndex[NUM_STATIONS] = {
  0,    // Station 0 → IN_PINS[0]
  1,    // Station 1 → IN_PINS[1]
  8,    // Station 2 → IN_PINS[8]
  12,   // Station 3 → IN_PINS[12]
  16,   // Station 4 → IN_PINS[16]
  19    // Station 5 → IN_PINS[19]
};

// ----------------------------- UTILS ----------------------------------
void setStationEnabled(uint8_t station, bool enabled) {
  if (station >= EEPROM_STATION_COUNT) return;
  if (stationEnabled[station] != enabled) {
    stationEnabled[station] = enabled;
    // write only when state changes (wear-protected)
    EEPROM.update(EEPROM_STATION_BASE + station, enabled ? 1 : 0);
  }

  #if DEBUG_SERIAL
    Serial.print(F("[EEPROM] Updated Station "));
    Serial.print(station);
    Serial.print(F(" -> "));
    Serial.println(enabled ? F("ENABLED") : F("DISABLED"));
  #endif
}

void ethernetResetPulse(){
  pinMode(ETH_RESET,OUTPUT);
  digitalWrite(ETH_RESET,LOW);
  delay(10);
  digitalWrite(ETH_RESET,HIGH);
  delay(100);
}

void initEthernet() {
  Ethernet.init(ETH_CS);
  ethernetResetPulse();
  Ethernet.begin(mac, ipMain);
  Udp.begin(UDP_PORT);
  Ethernet.setRetransmissionCount(1);
  Ethernet.setRetransmissionTimeout(200);

  delay(500); // Give W5500 time to settle

  EthernetLinkStatus linkStatus = Ethernet.linkStatus();
  if (linkStatus != LinkON) {
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

uint8_t xorChecksum(const uint8_t* d,uint8_t l){uint8_t c=0;for(uint8_t i=0;i<l;i++)c^=d[i];return c;}

uint8_t packBitsLSB(const bool* a,uint8_t n){
  uint8_t b=0; for(uint8_t i=0;i<n;i++) if(a[i]) b|=(1u<<i); return b;
}

void sendSetFrame(IPAddress dst,uint8_t id,uint8_t bits){
  uint8_t f[5];f[0]=0xAA;f[1]=id;f[2]=0x01;f[3]=bits;f[4]=xorChecksum(f,4);
  Udp.beginPacket(dst,UDP_PORT);
  Udp.write(f,5);
  Udp.endPacket();
  #if DEBUG_SERIAL
  Serial.print(F("[TX] ST="));Serial.print(id);
  Serial.print(F(" BITS="));Serial.println(bits,BIN);
  Serial.print(F(" CKS=0x")); Serial.println(f[4], HEX);
  #endif
}

// --------------------------------------------------------------
// 🎰 Vegas Mode LED Test Sequence
// --------------------------------------------------------------
void runVegasMode() {
  if (!ENABLE_VEGAS_MODE) return;

  #if DEBUG_SERIAL
    Serial.println(F("[VEGAS] Starting LED diagnostic sequence..."));
  #endif

  // --- 1️⃣ Sweep all RED LEDs ---
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++) {
    digitalWrite(LED_A[i], HIGH);   // RED ON
    delay(VEGAS_DELAY_MS);
    digitalWrite(LED_A[i], LOW);
  }

  delay(200);

  // --- 2️⃣ Sweep all GREEN LEDs ---
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++) {
    digitalWrite(LED_B[i], HIGH);   // GREEN ON
    delay(VEGAS_DELAY_MS);
    digitalWrite(LED_B[i], LOW);
  }

  delay(200);

  // --- 3️⃣ Station-by-station red/green flash ---
  uint8_t startIndex = 0;
  const uint8_t stationPairCount[NUM_STATIONS] = {2, 6, 4, 4, 3, 2};  // pairs per station

  for (uint8_t st = 0; st < NUM_STATIONS; st++) {
    for (uint8_t f = 0; f < VEGAS_FLASHES; f++) {
      for (uint8_t j = 0; j < stationPairCount[st]; j++) {
        uint8_t idx = startIndex + j;
        digitalWrite(LED_A[idx], HIGH);
        digitalWrite(LED_B[idx], LOW);
      }
      delay(200);
      for (uint8_t j = 0; j < stationPairCount[st]; j++) {
        uint8_t idx = startIndex + j;
        digitalWrite(LED_A[idx], LOW);
        digitalWrite(LED_B[idx], HIGH);
      }
      delay(200);
    }
    // turn off all LEDs for this station before next
    for (uint8_t j = 0; j < stationPairCount[st]; j++) {
      uint8_t idx = startIndex + j;
      digitalWrite(LED_A[idx], LOW);
      digitalWrite(LED_B[idx], LOW);
    }
    startIndex += stationPairCount[st];
  }

  delay(200);

  // --- 4️⃣ Global RED/GREEN flashes ---
  for (uint8_t f = 0; f < VEGAS_FLASHES; f++) {
    // all RED
    for (uint8_t i = 0; i < NUM_LED_PAIRS; i++) {
      digitalWrite(LED_A[i], HIGH);
      digitalWrite(LED_B[i], LOW);
    }
    delay(300);
    // all GREEN
    for (uint8_t i = 0; i < NUM_LED_PAIRS; i++) {
      digitalWrite(LED_A[i], LOW);
      digitalWrite(LED_B[i], HIGH);
    }
    delay(300);
  }

  // --- turn everything off ---
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++) {
    digitalWrite(LED_A[i], LOW);
    digitalWrite(LED_B[i], LOW);
  }

  #if DEBUG_SERIAL
    Serial.println(F("[VEGAS] LED test complete."));
  #endif
}

// --- Load Station Enable/Disable State from EEPROM ---
void loadStationEnableState() {
  for (uint8_t i = 0; i < EEPROM_STATION_COUNT; i++) {
    uint8_t val = EEPROM.read(EEPROM_STATION_BASE + i);
    if (val == 0 || val == 1)
      stationEnabled[i] = val;
    else
      stationEnabled[i] = true;
  }

  #if DEBUG_SERIAL
  Serial.println(F("[EEPROM] Loaded station enable states:"));
  for (uint8_t i = 0; i < EEPROM_STATION_COUNT; i++) {
    Serial.print(F("  Station "));
    Serial.print(i);
    Serial.print(F(": "));
    Serial.println(stationEnabled[i] ? F("ENABLED") : F("DISABLED"));
  }
  #endif
}

// ----------------------------- SETUP ----------------------------------
void setup(){
  #if DEBUG_SERIAL
    Serial.begin(115200);
    while(!Serial){}
    Serial.println();
    Serial.println(F("================================================"));
    Serial.println(F(" Main Controller Firmware"));
    Serial.print(F(" Version: ")); Serial.println(FIRMWARE_VERSION);
    Serial.println(F("================================================"));
    Serial.println(F("[BOOT] Main_Controller_Binary_Detailed starting..."));
  #endif

  // --- INPUT SETUP ---
  for(uint8_t i=0;i<NUM_INPUTS;i++){
    pinMode(IN_PINS[i], INPUT_PULLUP);
    lastRaw[i] = digitalRead(IN_PINS[i]);
    stableState[i] = !lastRaw[i];
  }

  // --- OUTPUT SETUP ---
  for(uint8_t k=0;k<NUM_LED_PAIRS;k++){
    pinMode(LED_A[k],OUTPUT);
    pinMode(LED_B[k],OUTPUT);
    digitalWrite(LED_A[k],LOW);
    digitalWrite(LED_B[k],HIGH);
  }

  // 🎰 Run startup LED diagnostic once after initialization
  if (ENABLE_VEGAS_MODE) {
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

  // --- Load Station Enable/Disable State from EEPROM ---
  loadStationEnableState();

  #if DEBUG_SERIAL
  for (uint8_t i = 0; i < EEPROM_STATION_COUNT; i++) {
      Serial.print(F("[EEPROM] Station "));
      Serial.print(i);
      Serial.print(F(" = "));
      Serial.println(stationEnabled[i] ? F("ENABLED") : F("DISABLED"));
    }
  #endif

  // --- Ethernet Initialization ---
  pinMode(53, OUTPUT);
  digitalWrite(53, HIGH);
  initEthernet();
}

// ----------------------------- LOOP -----------------------------------
void loop(){
  uint32_t now = millis();

  // 1) Debounce
  for(uint8_t i=0;i<NUM_INPUTS;i++){
    uint8_t r = digitalRead(IN_PINS[i]);
    if(r!=lastRaw[i]){
      lastChangeMs[i]=now;
      lastRaw[i]=r;
    } else if(now-lastChangeMs[i]>=DEBOUNCE_MS){
      uint8_t logical=!r;
      if(logical!=stableState[i]) stableState[i]=logical;
    }
  }

  // 2) Long-press detection for station enable/disable

  for(uint8_t id=0; id<NUM_STATIONS; id++){
    uint8_t idx = stationButtonIndex[id];
    bool pressed = stableState[idx];
    if(pressed && !pressActive[id]){
      pressActive[id] = true;
      pressStart[id] = now;
    }
    else if(!pressed && pressActive[id]){
      pressActive[id] = false;
    }
    else if(pressed && pressActive[id] && (now - pressStart[id] >= LONGPRESS_MS)){
      setStationEnabled(id, !stationEnabled[id]);
      pressActive[id] = false;
      #if DEBUG_SERIAL
      Serial.print(F("[TOGGLE] Station "));Serial.print(id);
      Serial.print(F(" -> "));Serial.println(stationEnabled[id] ? F("ENABLED") : F("DISABLED"));
      #endif
    }
  }

  // 3) Blink timer
  if(now - tBlink >= BLINK_INTERVAL_MS){
    tBlink = now;
    blinkPhase = !blinkPhase;
  }

  // 4) Heartbeat timeout
  for(uint8_t id=0; id<NUM_STATIONS; id++)
    stationOffline[id] = (now - lastHeartbeatMs[id] > HEARTBEAT_TIMEOUT_MS);

  // 5) LED + Ethernet logic
  EthernetLinkStatus linkStatus = Ethernet.linkStatus();
  bool linkDown = (linkStatus != LinkON);

  if(linkDown){
    // Cable unplugged: all LEDs blink RED
    for(uint8_t pair=0; pair<NUM_LED_PAIRS; pair++){
      digitalWrite(LED_B[pair], LOW);                    // turn off green
      digitalWrite(LED_A[pair], blinkPhase ? HIGH : LOW); // blink red
    }
  } else {
    for(uint8_t pair=0; pair<NUM_LED_PAIRS; pair++){
      uint8_t owner;
      if      (pair < 2)   owner = ST0;  // 0–1
      else if (pair < 8)   owner = ST1;  // 2–7
      else if (pair < 12)  owner = ST2;  // 8–11
      else if (pair < 16)  owner = ST3;  // 12–15
      else if (pair < 19)  owner = ST4;  // 16–18
      else                 owner = ST5;  // 19–20

      if(!stationEnabled[owner]){
        // Disabled → both off
        digitalWrite(LED_A[pair], LOW);
        digitalWrite(LED_B[pair], LOW);
      }
      else if(stationOffline[owner]){
        // Offline → alternate blink A/B
        digitalWrite(LED_A[pair], blinkPhase ? HIGH : LOW);
        digitalWrite(LED_B[pair], blinkPhase ? LOW : HIGH);
      }
      else{
        // Online → show true feedback bits
        uint8_t bitIndex;
        if      (owner==ST0) bitIndex = pair;
        else if (owner==ST1) bitIndex = pair-2;
        else if (owner==ST2) bitIndex = pair-8;
        else if (owner==ST3) bitIndex = pair-12;
        else if (owner==ST4) bitIndex = pair-16;
        else                 bitIndex = pair-19;

        bool relayOn = stationFeedback[owner][bitIndex];
        // Green = relayOn, Red = !relayOn
        digitalWrite(LED_A[pair], relayOn ? HIGH : LOW);   // RED
        digitalWrite(LED_B[pair], relayOn ? LOW  : HIGH);  // GREEN
      }
    }
  }

  // 6) Send frames periodically (every SEND_INTERVAL_MS)
  if (now - tSend >= SEND_INTERVAL_MS) {
    tSend = now;
    // --- Station 0 ---
    if (stationEnabled[ST0] && !stationOffline[ST0]) {
      bool s0[2]; for (uint8_t i=0;i<2;i++) s0[i] = stableState[i];
      sendSetFrame(ipS0, ST0, packBitsLSB(s0,2));
    }
    // --- Station 1 ---
    if (stationEnabled[ST1] && !stationOffline[ST1]) {
      bool s1[6]; for (uint8_t i=0;i<6;i++) s1[i] = stableState[i];
      sendSetFrame(ipS1, ST1, packBitsLSB(s1,6));
    }

    // --- Station 2 ---
    if (stationEnabled[ST2] && !stationOffline[ST2]) {
      bool s2[4]; for (uint8_t i=0;i<4;i++) s2[i] = stableState[8+i];
      sendSetFrame(ipS2, ST2, packBitsLSB(s2,4));
    }

    // --- Station 3 ---
    if (stationEnabled[ST3] && !stationOffline[ST3]) {
      bool s3[4]; for (uint8_t i=0;i<4;i++) s3[i] = stableState[12+i];
      sendSetFrame(ipS3, ST3, packBitsLSB(s3,4));
    }

    // --- Station 4 ---
    if (stationEnabled[ST4] && !stationOffline[ST4]) {
      bool s4[3]; for (uint8_t i=0;i<3;i++) s4[i] = stableState[16+i];
      sendSetFrame(ipS4, ST4, packBitsLSB(s4,3));
    }

    // --- Station 5 ---
    if (stationEnabled[ST5] && !stationOffline[ST5]) {
      bool s5[2]; for (uint8_t i=0;i<2;i++) s5[i] = stableState[19+i];
      sendSetFrame(ipS5, ST5, packBitsLSB(s5,2));
    }
  }

  // 7) Handle inbound heartbeats / feedback
  int sz = Udp.parsePacket();
  if (sz > 0) {
    uint8_t buf[16];
    int n = Udp.read(buf, sizeof(buf));

    // Heartbeat: [AB, id, status, cks]
    if (n >= 4 && buf[0] == 0xAB) {
      uint8_t id = buf[1], st = buf[2], cks = buf[3];
      if (((buf[0] ^ buf[1] ^ buf[2]) == cks) && id < NUM_STATIONS && st == 0x00) {
        lastHeartbeatMs[id] = now;
        #if DEBUG_SERIAL
        Serial.print(F("[HB ] Station ")); Serial.print(id); Serial.println(F(" OK"));
        #endif
      } else {
        #if DEBUG_SERIAL
        Serial.println(F("[HB ] Invalid heartbeat"));
        #endif
      }
    }

    // Feedback: [AC, id, bits, status, cks]  <-- adjust if your station format differs
    else if (n >= 5 && buf[0] == 0xAC) {
      uint8_t id   = buf[1];
      uint8_t bits = buf[2];
      uint8_t cks  = buf[4];
      if (((buf[0] ^ buf[1] ^ buf[2] ^ buf[3]) == cks) && id < NUM_STATIONS) {
        for (uint8_t i = 0; i < 8; i++) {
          stationFeedback[id][i] = (bits & (1 << i)) != 0;
        }
        lastHeartbeatMs[id] = now;

        #if DEBUG_SERIAL
        Serial.print(F("[FB ] Station ")); Serial.print(id);
        Serial.print(F(" bits: ")); Serial.println(bits, BIN);
        #endif
      } else {
        #if DEBUG_SERIAL
        Serial.println(F("[FB ] Invalid feedback"));
        #endif
      }
    }

  }

  // ---------------------------
  // 8) Override logic (always runs)
  // ---------------------------
  #if ENABLE_OVERRIDE
    // --------------------------------------------------------------
    // ------------------- Thermostat Override ----------------------
    // --------------------------------------------------------------
    // 🔄 Logical Override from Station 0 (A3) and Station 4 (A4)
    // --------------------------------------------------------------
    // If Station 0 feedback on A3 (index 2) is active → force ON inputs 4,5,11,16
    // If Station 4 feedback on A4 (index 3) is active → force ON input 19
    // When override feedbacks go LOW → restore physical switch control
    // --------------------------------------------------------------

    bool override_ST0 = stationFeedback[ST0][2]; // Station 0 A3
    bool override_ST4 = stationFeedback[ST4][3]; // Station 4 A4

    // --- Station 0 → overrides Station 1/2/3 switch inputs ---
    if (override_ST0) {
      stableState[4]  = 1; // Station 1 switch
      stableState[5]  = 1; // Station 1 switch
      stableState[11] = 1; // Station 2 switch
      stableState[16] = 1; // Station 3 switch
    } else {
      // restore real switch values
      stableState[4]  = !digitalRead(IN_PINS[4]);
      stableState[5]  = !digitalRead(IN_PINS[5]);
      stableState[11] = !digitalRead(IN_PINS[11]);
      stableState[16] = !digitalRead(IN_PINS[16]);
    }

    // --- Station 4 → overrides Station 4 switch input ---
    if (override_ST4) {
      stableState[19] = 1; // Station 4 switch
    } else {
      stableState[19] = !digitalRead(IN_PINS[19]);
    }

    #if DEBUG_SERIAL
      if (override_ST0 || override_ST4) {
        Serial.print(F("[OVERRIDE] ST0_A3="));
        Serial.print(override_ST0);
        Serial.print(F(" ST4_A4="));
        Serial.print(override_ST4);
        Serial.print(F(" | Affected inputs: 4,5,11,16,19\n"));
      }
    #endif
  #endif
}