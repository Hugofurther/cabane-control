/*
  Station_Generic_Binary_TM1637.ino
  ======================================================================
  BOARD:   Arduino Nano
  ETHERNET: W5500 module via SPI (not a shield)
            - MOSI = D11
            - MISO = D12
            - SCK  = D13
            - CS   = D10
            - RST  = D9

  PURPOSE:
    • Receive addressed 5-byte command frames from MAIN:
        [0]=0xAA, [1]=stationId, [2]=0x01 (SET), [3]=bitfield, [4]=XOR
      → Apply LSB-first bitfield to outputs (bit0 → OUT_PINS[0], ...)
    • Maintain last outputs if MAIN is silent (watchdog is passive)
    • Send 4-byte heartbeat to MAIN every 500 ms:
        [0]=0xAB, [1]=stationId, [2]=0x00 (OK), [3]=XOR
    • Pushbutton + TM1637 LED display allow selecting Station ID (1–9)
      which is stored in EEPROM for persistence.

  WATCHDOG PHILOSOPHY:
    - We *do not* force a safe/off state on timeout; we keep last known state.
      (This matches your requested behavior; can be changed later if needed.)

  DEBUG:
    - Toggle DEBUG_SERIAL to see decoded frames and checksums over Serial.
*/

#define DEBUG_SERIAL true

#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <TM1637Display.h>
#include <EEPROM.h>

// ===== Display presence & pins =====
#define HAS_TM1637 0   // Set to 1 when the 7-seg display is connected

#if HAS_TM1637
  #include <TM1637Display.h>
  // Move TM1637 off the W5500 reset pin to avoid conflicts.
  // Wiring: CLK → A1, DIO → A2
  const uint8_t CLK_PIN = A1;   // TM1637 Clock (safe pin)
  const uint8_t DIO_PIN = A2;   // TM1637 Data  (safe pin)
  TM1637Display display(CLK_PIN, DIO_PIN);
#endif

// ------------------- Station ID selection system --------------------
const uint8_t CLK_PIN = 8;           // TM1637 Clock
const uint8_t DIO_PIN = 9;           // TM1637 Data
const uint8_t BTN_PIN = A0;          // Pushbutton to cycle station number

TM1637Display display(CLK_PIN, DIO_PIN);
uint8_t STATION_ID = 1;              // Default if EEPROM empty
IPAddress ipMain(192,168,1,10);      // Main controller IP

void loadStationID() {
  uint8_t id = EEPROM.read(0);
  if (id < 1 || id > 9) id = 1;
  STATION_ID = id;
}

void saveStationID(uint8_t id) {
  uint8_t current = EEPROM.read(0);
  if (current != id) {
    EEPROM.write(0, id);
  }
}

void showStationID() {
  #if HAS_TM1637
    display.clear();
    display.showNumberDec(STATION_ID);
  #endif
}

void checkButton() {
  static uint32_t lastPress = 0;
  static bool lastState = HIGH;
  bool state = digitalRead(BTN_PIN);
  if (lastState == HIGH && state == LOW && millis() - lastPress > 300) {
    lastPress = millis();
    STATION_ID++;
    if (STATION_ID > 9) STATION_ID = 1;
    saveStationID(STATION_ID);
    showStationID();
    #if DEBUG_SERIAL
    Serial.print(F("[BTN] Station ID set to ")); Serial.println(STATION_ID);
    #endif
  }
  lastState = state;
}

// ------------------- Ethernet configuration --------------------
byte mac[] = {0xDE,0xAD,0xBE,0xEF,0x02,0x11};
IPAddress ip(192,168,1,11); // Placeholder, will be recomputed

const uint16_t UDP_PORT = 8888;
EthernetUDP Udp;
const uint8_t ETH_CS=10, ETH_RST=9;

const uint16_t HEARTBEAT_MS=500;
const uint16_t CMD_WATCHDOG_MS=1000;
uint32_t tHeartbeat=0, lastCmdMs=0;

const uint8_t OUT_COUNT=6;
const uint8_t OUT_PINS[6]={2,3,4,5,6,7};

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
  for(uint8_t i=0;i<OUT_COUNT;i++){
    bool on = (bits & (1u<<i)) != 0;
    digitalWrite(OUT_PINS[i], on ? HIGH : LOW);
  }
  #if DEBUG_SERIAL
  Serial.print(F("[OUT] bits=")); Serial.println(bits, BIN);
  #endif
}

// -------------------------- Setup -----------------------------------
void setup(){
  #if DEBUG_SERIAL
  Serial.begin(115200);
  while(!Serial){}; Serial.println(F("\n[BOOT] Station starting..."));
  #endif

  pinMode(LED_BUILTIN, OUTPUT); // Add on
  digitalWrite(LED_BUILTIN, LOW); // Add on

  pinMode(BTN_PIN, INPUT_PULLUP);
  display.setBrightness(0x0F);
  loadStationID();
  showStationID();

  for(uint8_t i=0;i<OUT_COUNT;i++) pinMode(OUT_PINS[i], OUTPUT);

  // Compute IP dynamically from Station ID
  ip = IPAddress(192,168,1,10 + STATION_ID);

  Ethernet.init(ETH_CS);
  ethernetResetPulse();
  Ethernet.begin(mac, ip);
  Udp.begin(UDP_PORT);

  // --- Seed random number generator for heartbeat jitter ---
  randomSeed(analogRead(A3));  // any unused floating analog pin works

  delay(500);
  EthernetLinkStatus linkStatus = Ethernet.linkStatus();
  if (linkStatus != LinkON) {
    #if DEBUG_SERIAL
    Serial.println(F("[NET] Link not detected, retrying init..."));
    #endif
    delay(1000);
    ethernetResetPulse();
    Ethernet.begin(mac, ip);
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
      if(ok){
        applyBitfieldLSB(dat);
        lastCmdMs = now;
      }
    }
  }

  if (now - tHeartbeat >= HEARTBEAT_MS) {
    // Add small random jitter (±50 ms)
    int16_t jitter = random(-50, 51);   // Random offset in milliseconds
    tHeartbeat = now + jitter;          // Schedule next send slightly offset

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

    // --- Heartbeat visual pulse (TM1637 optional) + onboard LED ---
    #if HAS_TM1637
      display.showNumberDecEx(STATION_ID, 0b01000000);
    #endif
    digitalWrite(LED_BUILTIN, HIGH);
    delay(150);
    showStationID();
    digitalWrite(LED_BUILTIN, LOW);
  }
}