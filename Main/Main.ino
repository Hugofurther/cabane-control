/*
  Main_Controller_Binary_Detailed.ino (Updated for mixed input types)
  ======================================================================
  BOARD:   Arduino Mega 2560
  ETHERNET: W5500 module (not a shield), connected via hardware SPI
            - MISO = D50  (also on ICSP pin 1)
            - MOSI = D51  (also on ICSP pin 4)
            - SCK  = D52  (also on ICSP pin 3)
            - CS   = D10  (selectable; we use 10)
            - RST  = D9   (recommended; pulsed at startup for clean reset)

  PURPOSE:
    • Read 15 debounced panel inputs (active-low hardware → logical HIGH in code)
    • Drive 28 LEDs organized as 14 ON/OFF pairs (mutually exclusive per pair)
    • Send addressed 5-byte binary frames to Station 1/2/3 every 100 ms
    • Receive 4-byte heartbeats from stations every ~500 ms
    • If a station is silent > 2 s, blink that station’s LED pairs in ALTERNATE mode
      (A ↔ B) every 500 ms until heartbeat resumes

  WHY BINARY FRAMES (vs JSON)?
    - Tiny, fixed size, deterministic timing (5 bytes vs ~40–60 bytes)
    - Zero text parsing overhead (no ArduinoJson dependency here)
    - Ideal for 100 ms control period on small MCUs

  FRAME DEFINITIONS (LSB-first bitfields)
  ----------------------------------------------------------------------
  MAIN → STATION  (5 bytes total)
    [0] 0xAA        Header (sync/tag)
    [1] stationId   1, 2, or 3
    [2] cmd         0x01 = SET_OUTPUTS
    [3] bitfield    LSB-first outputs (bit0 → OUT_PINS[0], bit1 → OUT_PINS[1], ...)
    [4] checksum    XOR of bytes [0..3]

  STATION → MAIN  heartbeat (4 bytes total)
    [0] 0xAB        Header
    [1] stationId   1, 2, or 3
    [2] status      0x00 = OK   (future: other codes)
    [3] checksum    XOR of bytes [0..2]

  LED OWNERSHIP
    Pairs 0..5  → Station 1
    Pairs 6..9  → Station 2
    Pairs 10..13→ Station 3

  SAFETY PHILOSOPHY
    - If MAIN is down, STATIONS keep last state (no forced toggles)
    - If STATION is down, MAIN indicates fault by alternate-blinking its pairs

  ======================================================================
  This version adds explicit support for push-button inputs with EXTERNAL
  10 kΩ pull-down resistors. These specific pins are configured as INPUT
  (floating when open) instead of INPUT_PULLUP.

  The remaining switch inputs continue using INPUT_PULLUP (internal 20–50 kΩ).
  The debounce and logic inversion routines automatically handle both types.

  CHANGES:
    - Added constant arrays:
        const uint8_t PULLDOWN_PINS[] = {37,4,8,11};
        const uint8_t PULLDOWN_COUNT = sizeof(PULLDOWN_PINS)/sizeof(PULLDOWN_PINS[0]);
    - In setup(): inputs are first set to INPUT_PULLUP, then the PULLDOWN_PINS
      are reconfigured to plain INPUT for external resistor operation.
*/

// -------------------------------------------------------------------
// Compile-time diagnostics flag. Set to true for bench testing to see
// parsed frames, checksums, and state changes over USB Serial Monitor.
// Keep FALSE in production for deterministic timing.
// -------------------------------------------------------------------
#define DEBUG_SERIAL true

#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <EEPROM.h>

// --- EEPROM addresses ---
const uint8_t EEPROM_STATION_BASE = 0;   // start address
const uint8_t EEPROM_STATION_COUNT = 5;  // 5 stations total

// ----------------------------- NETWORK ------------------------------
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x10 };

// Fixed IPs per design
IPAddress ipMain(192,168,1,10);  // This Mega
IPAddress ipS1  (192,168,1,11);  // Station 1
IPAddress ipS2  (192,168,1,12);  // Station 2
IPAddress ipS3  (192,168,1,13);  // Station 3
IPAddress ipS4  (192,168,1,14);  // Station 4
IPAddress ipS5  (192,168,1,15);  // Station 5

const uint16_t UDP_PORT = 8888;  // UDP port for all nodes

EthernetUDP Udp;                 // Single socket for RX/TX

// W5500 control pins on MEGA
const uint8_t ETH_CS    = 10;    // Chip Select
const uint8_t ETH_RESET = 9;     // Reset pin to W5500

// ----------------------------- I/O MAP ------------------------------
#define NUM_STATIONS   5
#define NUM_INPUTS     21    // switches
#define NUM_LED_PAIRS  21    // pairs of A/B LEDs

// ===== Input Switch Pins =====
// (One per switch, total 21)
const uint8_t IN_PINS[NUM_INPUTS] = {
  // Station 1 (8)
  22,23,24,25,26,27,28,29,
  // Station 2 (4)
  46,47,48,49,
  // Station 3 (4)
  62,63,64,65,
  // Station 4 (3)
  74,75,76,
  // Station 5 (2)
  83,84
};

// ADDITION — push-button inputs using EXTERNAL 10kΩ PULL-DOWNs
// const uint8_t PULLDOWN_PINS[] = {};
// const uint8_t PULLDOWN_COUNT = sizeof(PULLDOWN_PINS) / sizeof(PULLDOWN_PINS[0]);

// ===== LED Output Pins =====
// (21 pairs → 42 pins total)

const uint8_t LED_A[NUM_LED_PAIRS] = {
  // Station 1
  30,31,32,33,34,35,36,37,
  // Station 2
  54,55,56,57,
  // Station 3
  66,67,68,69,
  // Station 4
  77,78,79,
  // Station 5
  85,86
};

const uint8_t LED_B[NUM_LED_PAIRS] = {
  // Station 1
  38,39,40,41,42,43,44,45,
  // Station 2
  58,59,60,61,
  // Station 3
  70,71,72,73,
  // Station 4
  80,81,82,
  // Station 5
  87,88
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
enum { ST1 = 1, ST2, ST3, ST4, ST5 };

// ===== Station Runtime State =====
uint32_t lastHeartbeatMs[NUM_STATIONS + 1] = {0};
// Show all "online" at startup until proven otherwise
bool stationOffline[NUM_STATIONS + 1] = {false, false, false, false, false, false};
// Station enable flags
bool stationEnabled[NUM_STATIONS + 1] = {false, true, true, true, true, true};

// Long-press detection
const uint32_t LONGPRESS_MS = 5000; // 30000 30 seconds
uint32_t pressStart[NUM_STATIONS + 1] = {0};
bool     pressActive[NUM_STATIONS + 1] = {false};

// ----------------------------- UTILS ----------------------------------
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

// ----------------------------- SETUP ----------------------------------
void setup(){
  #if DEBUG_SERIAL
  Serial.begin(115200);
  while(!Serial){}
  Serial.println(F("\n[BOOT] Main_Controller_Binary_Detailed starting..."));
  #endif

  // --- INPUT SETUP ---
  for(uint8_t i=0;i<NUM_INPUTS;i++){
    pinMode(IN_PINS[i], INPUT_PULLUP);
    lastRaw[i] = digitalRead(IN_PINS[i]);
    stableState[i] = !lastRaw[i];
  }

  // for(uint8_t i=0;i<PULLDOWN_COUNT;i++){
  //   uint8_t pin = PULLDOWN_PINS[i];
  //   pinMode(pin, INPUT);
  // }

  // --- OUTPUT SETUP ---
  for(uint8_t k=0;k<NUM_LED_PAIRS;k++){
    pinMode(LED_A[k],OUTPUT);
    pinMode(LED_B[k],OUTPUT);
    digitalWrite(LED_A[k],LOW);
    digitalWrite(LED_B[k],HIGH);
  }

  // --- Load Station Enable/Disable State from EEPROM ---
  for (uint8_t i = 0; i < EEPROM_STATION_COUNT; i++) {
    uint8_t val = EEPROM.read(EEPROM_STATION_BASE + i);
    if (val == 0 || val == 1) {
      stationEnabled[i + 1] = val;  // station index starts at 1
    } else {
      stationEnabled[i + 1] = true; // default to enabled if uninitialized
    }
  }

  #if DEBUG_SERIAL
  for (uint8_t i = 1; i <= EEPROM_STATION_COUNT; i++) {
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
  const uint8_t stationButtonIndex[NUM_STATIONS + 1] = {
    255,  // [0] unused
    0,    // Station 1 button → IN_PINS[0]
    8,    // Station 2 button → IN_PINS[8]
    12,   // Station 3 button → IN_PINS[12]
    16,   // Station 4 button → IN_PINS[16]
    19    // Station 5 button → IN_PINS[19]
  };

  for(uint8_t id=1; id<=NUM_STATIONS; id++){
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
      stationEnabled[id] = !stationEnabled[id];
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
  for(uint8_t id=1; id<=NUM_STATIONS; id++)
    stationOffline[id] = (now - lastHeartbeatMs[id] > HEARTBEAT_TIMEOUT_MS);

  // 5) LED + Ethernet logic (Option A + C)
  EthernetLinkStatus linkStatus = Ethernet.linkStatus();
  bool linkDown = (linkStatus != LinkON);

  if(linkDown){
    // Cable unplugged: all LEDs blink red
    for(uint8_t pair=0; pair<NUM_LED_PAIRS; pair++){
      digitalWrite(LED_A[pair], LOW);
      digitalWrite(LED_B[pair], blinkPhase ? HIGH : LOW);
    }
  } else {
    for(uint8_t pair=0; pair<NUM_LED_PAIRS; pair++){
      uint8_t owner;
      if      (pair < 8)   owner = ST1;  // 0–7
      else if (pair < 12)  owner = ST2;  // 8–11
      else if (pair < 16)  owner = ST3;  // 12–15
      else if (pair < 19)  owner = ST4;  // 16–18
      else                 owner = ST5;  // 19–20

      if(!stationEnabled[owner]){
        digitalWrite(LED_A[pair], LOW);
        digitalWrite(LED_B[pair], LOW);
      }
      else if(stationOffline[owner]){
        digitalWrite(LED_A[pair], blinkPhase ? HIGH : LOW);
        digitalWrite(LED_B[pair], blinkPhase ? LOW : HIGH);
      }
      else{
        digitalWrite(LED_A[pair], stableState[pair] ? HIGH : LOW);
        digitalWrite(LED_B[pair], stableState[pair] ? LOW : HIGH);
      }
    }
  }

  // 6) Send frames periodically (every SEND_INTERVAL_MS)
  if (now - tSend >= SEND_INTERVAL_MS) {
    tSend = now;
    // --- Station 1 ---
    if (stationEnabled[ST1] && !stationOffline[ST1]) {
      bool s1[8]; for (uint8_t i=0;i<8;i++) s1[i] = stableState[i];
      sendSetFrame(ipS1, ST1, packBitsLSB(s1,8));
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

  // 7) Handle inbound heartbeats
  int sz = Udp.parsePacket();
  if(sz>0){
    uint8_t buf[16];
    int n = Udp.read(buf,sizeof(buf));
    if(n>=4 && buf[0]==0xAB){
      uint8_t id=buf[1], st=buf[2], cks=buf[3];
      if((buf[0]^buf[1]^buf[2])==cks && id>=1 && id<=NUM_STATIONS && st==0x00){
        lastHeartbeatMs[id]=now;
        #if DEBUG_SERIAL
        Serial.print(F("[HB ] Station ")); Serial.print(id); Serial.println(F(" OK"));
        #endif
      }
      else{
        #if DEBUG_SERIAL
        Serial.println(F("[HB ] Invalid heartbeat"));
        #endif
      }
    }
  }
}