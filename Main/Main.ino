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
/* ================= FUNCTION INDEX =================
 setup()................... hardware initialization
 loop().................... main runtime cycle
 runVegasMode()............ LED diagnostics
 loadStationStatesFromEEPROM().. EEPROM read
 sendSetFrame()............ UDP transmitter
 readMcpA()/B()............ expander interrupt handlers
 updateBuzzer()............ alarm system
 ==================================================== */

// -------------------------------------------------------------------
// Compile-time diagnostics flag. Set to true for bench testing to see
// parsed frames, checksums, and state changes over USB Serial Monitor.
// Keep FALSE in production for deterministic timing.
// -------------------------------------------------------------------
#define FIRMWARE_VERSION "v1.2.0 (2025-10-16)"
#define DEBUG_SERIAL true
// ---------------- GLOBAL SETTINGS ----------------
#define THERMOSTAT_ENABLED true // master enable for thermostat system


// ============================================================
// 🧩 SECTION: INCLUDE LIBRARIES
// ============================================================
#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <EEPROM.h>
#include <Wire.h>
#include <Adafruit_MCP23X17.h>   // ✅ new unified header
Adafruit_MCP23X17 mcp;           // ✅ new class name
#include <avr/wdt.h>

// ============================================================
// 🧩 SECTION: HELPER MACROS
// ============================================================
#define LED_RED(idx, on)    digitalWrite(LED_A[idx], (on))
#define LED_GREEN(idx, on)  digitalWrite(LED_B[idx], (on))
#define LED_PAIR(idx, redOn, greenOn) \
  do { digitalWrite(LED_A[idx], (redOn)); digitalWrite(LED_B[idx], (greenOn)); } while(0)

// -------------------------------------------------------------------
// Forward declarations for helper functions (defined later)
// -------------------------------------------------------------------
void setStationEnabled(uint8_t station, bool enabled);
void digitalWriteAll(const uint8_t* pins, uint8_t count, bool state);
void readMcpA();
void readMcpB();
bool readThermoDebounced(uint8_t index, uint8_t pin, uint32_t now);
void loadStationStatesFromEEPROM();
void updateBuzzer(uint32_t now);
void runVegasMode();


// ============================================================
// 🧩 SECTION: HARDWARE CONFIGURATION & CONSTANTS
// ============================================================

// ============================================================
// 🔧 SUBSYSTEM: MCP23017 INPUT EXPANDER
// ============================================================

// --- MCP23017 ---
#define MCP_I2C_ADDR 0x20   // DIP-switch address
#define MCP_INTA_PIN 18     // interrupt from port A
#define MCP_INTB_PIN 19     // interrupt from port B

// --- Network ---
const uint8_t ETH_CS    = 48;    // Chip Select
const uint8_t ETH_RESET = 49;     // Reset pin to W5500
const uint16_t UDP_PORT = 8888;  // UDP port for all nodes

// --- Buzzer ---
#define PIN_BUZZER 2  // D2, hardware buzzer output
#define BUZZER_QUEUE_SIZE 8

// --- Inputs ---
#define NUM_INPUTS 8  // only the physical ones read directly
#define TOTAL_INPUTS 24
#define NUM_STATIONS   6

// --- LED pairs ---
#define NUM_LED_PAIRS    24
#define LEDPAIR_BUZZER   21
#define LEDPAIR_THERM1   22
#define LEDPAIR_THERM2   23

// ============================================================
// 🧩 SECTION: CONSTANTS & TIMING
// ============================================================
const uint16_t DEBOUNCE_MS           = 25;
const uint16_t SEND_INTERVAL_MS      = 50;
const uint16_t HEARTBEAT_TIMEOUT_MS  = 2000;
const uint16_t BLINK_INTERVAL_MS     = 250;
const uint16_t THERMO_DEBOUNCE_MS    = 50;  // debounce duration
const uint32_t LONGPRESS_MS          = 5000; // 30000 30 seconds
const uint16_t BUZZER_BLINK_MS       = 150; // blink period during active alarm

// Vegas Mode Configuration
// --------------------------------------------------------------
const bool ENABLE_VEGAS_MODE = true;   // Set false to skip startup LED test
constexpr uint16_t VEGAS_DELAY_MS = 60;    // Speed between LEDs (adjust to taste)
constexpr uint8_t VEGAS_FLASHES = 2;       // Number of red/green blinks per station


// ============================================================
// 🌐 SECTION: NETWORK CONFIGURATION
// ============================================================

byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x10 };

// Fixed IPs per design
IPAddress ipMain(192,168,1,1);  // This Mega
IPAddress ipS0(192,168,1,10);   // Station 0
IPAddress ipS1(192,168,1,11);   // Station 1
IPAddress ipS2(192,168,1,12);   // Station 2
IPAddress ipS3(192,168,1,13);   // Station 3
IPAddress ipS4(192,168,1,14);   // Station 4
IPAddress ipS5(192,168,1,15);   // Station 5

EthernetUDP Udp;                 // Single socket for RX/TX


// ============================================================
// 🧠 SECTION: RUNTIME VARIABLES
// ============================================================

// --- MCP23017 input tracking ---
volatile bool mcpIntA_Flag = false;
volatile bool mcpIntB_Flag = false;
uint8_t mcpStateA = 0xFF;   // bit = 1 means switch not pressed (pull-ups)
uint8_t mcpStateB = 0xFF;

// --- Station runtime state ---
uint32_t lastHeartbeatMs[NUM_STATIONS] = {0};
bool stationOffline[NUM_STATIONS] = {false};
bool stationEnabled[NUM_STATIONS] = {true}; // Station enable flags
uint8_t stationFeedback[NUM_STATIONS]; // each bit = one output relay

// --- Button & press tracking ---
uint32_t pressStart[NUM_STATIONS] = {0};
bool     pressActive[NUM_STATIONS] = {false};

// --- Buzzer state ---
bool buzzerActive = false;
bool buzzerOn = false;
uint8_t currentPattern = 0;
uint8_t beepStep = 0;
uint32_t beepTimer = 0;
uint32_t lastBuzzerBlinkMs = 0;             // time marker for LED blink phase
bool buzzerBlinkPhase = false;              // toggled with buzzer rhythm

// --- LED blink/heartbeat ---
uint32_t tSend  = 0;
uint32_t tBlink = 0;
bool     blinkPhase = false;
uint32_t lastQueuedMs[NUM_STATIONS] = {0};  // per-station re-queue cooldown


// ============================================================
// 🔔 SECTION: BUZZER & VACUUM SUBSYSTEMS
// ============================================================

// ------------------------ BUZZER RHYTHM LOGIC ------------------------
struct BeepPattern {
  uint8_t count;     // number of beeps
  uint16_t baseDur;  // base duration of one beep
};

// ------------------------ BUZZER QUEUE SYSTEM ------------------------
uint8_t buzzerQueue[BUZZER_QUEUE_SIZE];
uint8_t buzzerHead = 0, buzzerTail = 0;

bool buzzerQueueEmpty() { return buzzerHead == buzzerTail; }
bool buzzerQueueFull()  { return ((buzzerTail + 1) % BUZZER_QUEUE_SIZE) == buzzerHead; }

void buzzerQueuePush(uint8_t st) {
  if (!buzzerQueueFull()) {
    buzzerQueue[buzzerTail] = st;
    buzzerTail = (buzzerTail + 1) % BUZZER_QUEUE_SIZE;
  }
}

uint8_t buzzerQueuePop() {
  uint8_t st = buzzerQueue[buzzerHead];
  buzzerHead = (buzzerHead + 1) % BUZZER_QUEUE_SIZE;
  return st;
}

const BeepPattern STATION_BEEP[4] = {
  {1, 600},   // Station 1 (1 long beep)
  {2, 200},   // Station 2 (2 semi-long)
  {3, 120},   // Station 3 (3 short)
  {4, 85}     // Station 4 (5 short, roughly x/7 base)
};


// ============================================================
// 💡 SECTION: PIN MAPPING TABLES
// ============================================================

const uint8_t PHYS_SW_PINS[NUM_INPUTS] = {62,63,64,65,66,67,68,69};

// ===== LED Output Pins (24 pairs = 48 pins) =====
// Each pair = RED (LED_A) + GREEN (LED_B)
//
//   • RED  → LED_A[] = even-numbered pins (D4, D6, D8, … D60)
//   • GREEN → LED_B[] = odd-numbered pins  (D5, D7, D9, … D61)
//
// Relay Logic (displayed via feedback):
//   • GREEN = Relay active (energized) → current flowing
//   • RED   = Relay inactive (open)    → no current flow
//
// This even/odd pairing keeps wiring logical and symmetrical:
//   D4/D5, D6/D7, D8/D9, … D58/D59
//
// Example LED behavior:
//   - relayOn == true  → GREEN ON  (LED_B HIGH, LED_A LOW)
//   - relayOn == false → RED ON    (LED_A HIGH, LED_B LOW)
const uint8_t LED_A[NUM_LED_PAIRS] = {  // 🔴 RED pins (even)
  4,6,8,10,12,14,16,
  22,24,26,28,30,32,34,36,38,40,42,44,46,
  54,56,58,60
};

const uint8_t LED_B[NUM_LED_PAIRS] = {  // 🟢 GREEN pins (odd)
  5,7,9,11,13,15,17,
  23,25,27,29,31,33,35,37,39,41,43,45,47,
  55,57,59,61
};

// Each LED pair index maps directly to its owning station.
// ST0 = 0, ST1 = 1, ST2 = 2, ST3 = 3, ST4 = 4, ST5 = 5
// Last pairs 21–23 are reserved for buzzer/thermostats.
enum { ST0 = 0, ST1, ST2, ST3, ST4, ST5 };
const uint8_t LED_OWNER[NUM_LED_PAIRS] = {
  ST0, ST0,        // 0–1  Station 0
  ST1, ST1, ST1, ST1, ST1, ST1,  // 2–7  Station 1
  ST2, ST2, ST2, ST2,            // 8–11 Station 2
  ST3, ST3, ST3, ST3,            // 12–15 Station 3
  ST4, ST4, ST4,                 // 16–18 Station 4
  ST5, ST5,                      // 19–20 Station 5
  255, 255, 255                  // 21–23 reserved / buzzer/thermos
};

// Long-press detection parameters
// ----------------------------- BUTTON MAPPING -----------------------------
// Maps each station to the index of its main control button in IN_PINS[]
const uint8_t stationButtonIndex[NUM_STATIONS] = {
  0,   // Station 0 → stableState[0]
  1,   // Station 1 → stableState[1]
  8,   // Station 2 → stableState[8]
  12,  // Station 3 → stableState[12]
  16,  // Station 4 → stableState[16]
  19   // Station 5 → stableState[19]
};


// ============================================================
// 🧩 SECTION: VACUUM ALARM & BUZZER COORDINATION
// ============================================================
// ----------------------------- VACUUM ALERT MAPPING -----------------------------
struct VacuumMap {
  uint8_t switchIndex[2];  // up to 2 switches per station
  uint8_t ledPair[2];      // up to 2 LED pairs per station
  uint8_t stationID;       // source station for feedback
  uint8_t bitIndex[2];     // which bits in stationFeedback[] correspond
};

// Define mapping for each vacuum station
const VacuumMap VACUUMS[4] = {
  { {2, 3},   {2, 3},   1, {0, 1} }, // Station 1
  { {9, 255}, {9, 255}, 2, {0, 255} }, // Station 2
  { {14,255}, {14,255}, 3, {0, 255} }, // Station 3
  { {17,255}, {17,255}, 4, {0, 255} }  // Station 4
};


// ---- Control switch indices inside stableState[] ----
// (GPB0..7 map to stableState[16..23])
#define IDX_BUZZER_EN    21  // GPB5
#define IDX_THERM1_EN    22  // GPB6
#define IDX_THERM2_EN    23  // GPB7
// ===== Input Switch Pins (24 total) =====

// MCP bit mapping for vacuum switches (for ports A/B)
#define VAC_SW_S2_A_BIT 1   // GPA1volatile bool mcpIntA_Flag
#define VAC_SW_S3_A_BIT 6   // GPA6
#define VAC_SW_S4_B_BIT 1   // GPB1

// --- EEPROM addresses ---
const uint8_t EEPROM_STATION_BASE = 0;   // start address
const uint8_t EEPROM_STATION_COUNT = 6;  // 6 stations total





// ----------------------------- TIMING --------------------------------


uint32_t lastChangeMs[NUM_INPUTS] = {0};
// --- Thermostat signal debouncing ---
uint32_t lastThermoReadMs[2] = {0, 0};
bool thermoFiltered[2] = {false, false};  // filtered logic for A3 (index 0) and A4 (index 1)
uint8_t stableState[TOTAL_INPUTS] = {0};   // logical debounced values



// -------------------------------------------------------------------
// FUNCTION: ethernetResetPulse() / initEthernet()
// PURPOSE : Performs controlled hardware reset of W5500 module,
//           initializes Ethernet interface, and retries if no link.
// -------------------------------------------------------------------
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

inline uint8_t xorChecksum(const uint8_t* d, uint8_t l) {
  uint8_t c = 0;
  for (uint8_t i = 0; i < l; i++) c ^= d[i];
  return c;
}

// Efficient bit-packing utility
inline uint8_t packBitsLSB(const bool *arr, uint8_t n) {
  uint8_t v = 0;
  for (uint8_t i = 0; i < n; i++) v |= arr[i] << i;
  return v;
}

// -------------------------------------------------------------------
// FUNCTION: sendSetFrame()
// PURPOSE : Builds and sends 5-byte UDP command frame [AA,id,01,bits,cks]
// INPUTS  : dst (station IP), id (station number), bits (relay bitfield)
// -------------------------------------------------------------------
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
// ============================================================================
// FUNCTION: setup()
// PURPOSE : Initializes hardware, network, EEPROM, MCP23017 expanders,
//           I/O directions, and LED diagnostics (Vegas mode).
// NOTES   : Called once at startup before main loop.
// ============================================================================
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

  wdt_enable(WDTO_8S);

  // --- MCP23017 Initialization ---
  mcp.begin_I2C(MCP_I2C_ADDR);

  // --- Configure MCP23017 for 16 input switches + interrupt outputs ---
  for (uint8_t p = 0; p < 8; p++) {
    mcp.pinMode(p, INPUT_PULLUP);      // GPA0-7
    mcp.pinMode(p + 8, INPUT_PULLUP);  // GPB0-7
  }

  // Enable mirrored interrupts: any change on A or B sets its INT line low
  mcp.setupInterrupts(false, false, LOW);   // open-drain active-low outputs
  for (uint8_t p = 0; p < 16; p++) {
    mcp.setupInterruptPin(p, CHANGE);
  }

  pinMode(MCP_INTA_PIN, INPUT_PULLUP);
  pinMode(MCP_INTB_PIN, INPUT_PULLUP);

  // initial snapshot read, before attachInterrupt
  mcpStateA = mcp.readGPIO(0);  // port A
  mcpStateB = mcp.readGPIO(1);  // port B
  // and copy to stableState (to initialize indices 8..23)
  for (uint8_t b = 0; b < 8; b++) {
    stableState[8  + b] = ((mcpStateA & (1 << b)) == 0);
    stableState[16 + b] = ((mcpStateB & (1 << b)) == 0);
  }

  // attach interrupt service routines
  attachInterrupt(digitalPinToInterrupt(MCP_INTA_PIN), [](){ mcpIntA_Flag = true; }, FALLING);
  attachInterrupt(digitalPinToInterrupt(MCP_INTB_PIN), [](){ mcpIntB_Flag = true; }, FALLING);


  // --- INPUT SETUP ---
  for (uint8_t i=0; i<NUM_INPUTS; i++) {
    pinMode(PHYS_SW_PINS[i], INPUT_PULLUP);
    uint8_t r = digitalRead(PHYS_SW_PINS[i]);
    stableState[i] = !r;   // active-low
  }

  // --- OUTPUT SETUP ---
  for(uint8_t k=0;k<NUM_LED_PAIRS;k++){
    pinMode(LED_A[k],OUTPUT);
    pinMode(LED_B[k],OUTPUT);
    LED_PAIR(k, LOW, HIGH);
  }

  // --- Additional Buzzer ---
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

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
  loadStationStatesFromEEPROM();

  // --- Ethernet Initialization ---
  pinMode(53, OUTPUT);
  digitalWrite(53, HIGH);
  initEthernet();
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
void loop(){

  wdt_reset();

  // timing & link tracking
  uint32_t now = millis();
  static uint32_t lastLinkCheck = 0;
  static bool linkDown = false;

  // LED feedback reuse
  uint8_t pair = 0, owner = 0, bitIndex = 0;
  bool relayOn = false;

  // Vacuum logic reuse
  bool vacSwitch = false, vacSignal = false, alarmActive = false;
  bool anyVacuumAlarm = false, vacuumAlarm = false;

  // UDP communication reuse
  int sz = 0, n = 0;
  uint8_t buf[16];
  uint8_t id = 0, bits = 0, cks = 0, st = 0;

  // Thermostat logic reuse
  bool thermoEnable1 = false, thermoEnable2 = false;
  bool thermoSignal1 = false, thermoSignal2 = false;

  // ============================================
  // MAIN LOOP LOGIC STARTS HERE
  // ============================================

  // 1) Debounce
  // ----------------- 1) Read all inputs -----------------
  for (uint8_t i = 0; i < NUM_INPUTS; i++) {
    uint8_t r = digitalRead(PHYS_SW_PINS[i]);
    stableState[i] = !r; // active-low
  }

  // If MCP interrupt flags set, read ports to update remaining 16 inputs
  // -------------------------------------------------------------------
  // FUNCTION: readMcpA() / readMcpB()
  // PURPOSE : Reads GPIO states from MCP23017 when interrupt occurs,
  //           ensuring no change events are lost.
  // -------------------------------------------------------------------
  if (mcpIntA_Flag) readMcpA();
  if (mcpIntB_Flag) readMcpB();

  // Copy MCP bits into stableState[8..23]
  for (uint8_t b = 0; b < 8; b++) {
    stableState[8 + b]  = ((mcpStateA & (1 << b)) == 0); // active low
    stableState[16 + b] = ((mcpStateB & (1 << b)) == 0);
  }

  #if DEBUG_SERIAL
    for (uint8_t i=0;i<TOTAL_INPUTS;i++){
      Serial.print(stableState[i]); Serial.print(' ');
    }
    Serial.println();

    Serial.print(F("MCP A: ")); Serial.print(~mcpStateA, BIN);
    Serial.print(F("  MCP B: ")); Serial.println(~mcpStateB, BIN);
  #endif

  // 2) Long-press detection for station enable/disable

  for(id=0; id<NUM_STATIONS; id++){
    uint8_t idx = stationButtonIndex[id];
    bool pressed = stableState[idx];
    if(pressed && !pressActive[id]){
      pressActive[id] = true;
      pressStart[id] = now;
    } else if(!pressed && pressActive[id]){
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
  for(id=0; id<NUM_STATIONS; id++){
    stationOffline[id] = (now - lastHeartbeatMs[id] > HEARTBEAT_TIMEOUT_MS);
  }

  // 5) LED + Ethernet logic
  if (now - lastLinkCheck >= 250) {  // check every 250 ms
    lastLinkCheck = now;
    linkDown = (Ethernet.linkStatus() != LinkON);
  }

  if (linkDown) {
    // Cable unplugged → all LEDs blink RED together
    digitalWriteAll(LED_B, NUM_LED_PAIRS, LOW);              // greens off
    digitalWriteAll(LED_A, NUM_LED_PAIRS, blinkPhase);       // reds blink
  } else {
    for (pair = 0; pair < NUM_LED_PAIRS; pair++) {
      uint8_t owner = LED_OWNER[pair];
      if (owner >= NUM_STATIONS) continue;  // skip reserved LED pairs

      if (!stationEnabled[owner]) {
        // Disabled → both off
        LED_PAIR(pair, LOW, LOW);
      }
      else if (stationOffline[owner]) {
        // Offline → alternate blink A/B
        LED_PAIR(pair, blinkPhase ? HIGH : LOW, blinkPhase ? LOW : HIGH);
      }
      else {
        // Online → show true feedback bits
        switch (owner) {
          case ST0: bitIndex = pair;     break;
          case ST1: bitIndex = pair - 2; break;
          case ST2: bitIndex = pair - 8; break;
          case ST3: bitIndex = pair - 12; break;
          case ST4: bitIndex = pair - 16; break;
          case ST5: bitIndex = pair - 19; break;
        }
        relayOn = (stationFeedback[owner] >> bitIndex) & 1;
        LED_PAIR(pair, relayOn ? HIGH : LOW, relayOn ? LOW : HIGH);
      }
    }
  }  // ✅ end else (linkDown)
  
  // ----------------VACUUM VISUAL LOGIC ----------------
  anyVacuumAlarm = false;  // will drive the buzzer LED behavior

  for (st = 0; st < 4; st++) {
    const VacuumMap &v = VACUUMS[st];

    // --- Determine if any vacuum switch for this station is ON ---
    vacSwitch = false;
    for (uint8_t s = 0; s < 2; s++) {
      uint8_t idx = v.switchIndex[s];
      if (idx != 255 && stableState[idx]) vacSwitch = true;
    }

    // --- Determine vacuum signal state (LOW = fault) ---
    vacSignal = false;
    for (uint8_t b = 0; b < 2; b++) {
      uint8_t bit = v.bitIndex[b];
      if (bit != 255 && ((stationFeedback[v.stationID] >> bit) & 1)) vacSignal = true;
    }

    alarmActive = (vacSwitch && !vacSignal);
    if (alarmActive) anyVacuumAlarm = true;

    // --- Update LED pairs ---
    for (uint8_t k = 0; k < 2; k++) {
      uint8_t led = v.ledPair[k];
      if (led == 255) continue;

      if (alarmActive) {
        // Blinking red if active alarm and buzzer switch ON
        if (stableState[IDX_BUZZER_EN]) {
          LED_PAIR(led, buzzerBlinkPhase ? HIGH : LOW, LOW);
        } else {
          // buzzer switch off → steady red
          LED_PAIR(led, HIGH, LOW);
        }
      } else {
        // Normal state: red if signal LOW, green if HIGH
        relayOn = vacSignal;
        LED_PAIR(led, relayOn ? LOW : HIGH, relayOn ? HIGH : LOW);
      }
    }
  }

  // ----------------------------- BUZZER LED VISUAL -----------------------------
  bool buzzerSwitchOn = stableState[IDX_BUZZER_EN];

  if (!buzzerSwitchOn) {
    // Buzzer switch OFF → solid red
    LED_PAIR(LEDPAIR_BUZZER, HIGH, LOW);
  }
  else if (anyVacuumAlarm) {
    // Buzzer switch ON + active vacuum alarm → blinking red
    LED_PAIR(LEDPAIR_BUZZER, buzzerBlinkPhase ? HIGH : LOW, LOW);
  }
  else {
    // Buzzer ON + no alarms → steady green
    LED_PAIR(LEDPAIR_BUZZER, LOW, HIGH);
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
      bool s1[6]; for (uint8_t i=0;i<6;i++) s1[i] = stableState[2+i];
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
  sz = Udp.parsePacket();
  if (sz > 0) {
    n = Udp.read(buf, sizeof(buf));

    // Heartbeat: [AB, id, status, cks]
    if (n >= 4 && buf[0] == 0xAB) {
      id = buf[1], st = buf[2], cks = buf[3];
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

    // 8) Feedback: [AC, id, bits, status, cks]  <-- adjust if your station format differs
    else if (n >= 5 && buf[0] == 0xAC) {
      id   = buf[1];
      bits = buf[2];
      cks  = buf[4];
      if (((buf[0] ^ buf[1] ^ buf[2] ^ buf[3]) == cks) && id < NUM_STATIONS) {
        stationFeedback[id] = bits;  // each bit represents relay state
        lastHeartbeatMs[id] = now;

        // --- BUZZER VACUUM DETECTION LOGIC (with cooldown) ---
        if (id >= 1 && id <= 4) { // Stations 1–4 only
          vacuumAlarm = !((stationFeedback[id] >> 0) & 1); // bit0 = vacuum
          if (vacuumAlarm) {
            uint16_t cooldown = STATION_BEEP[id - 1].baseDur * STATION_BEEP[id - 1].count * 2;
            if (now - lastQueuedMs[id] >= cooldown) {
              buzzerQueuePush(id);
              lastQueuedMs[id] = now;
              #if DEBUG_SERIAL
                Serial.print(F("[BUZZ] Queued Station "));
                Serial.print(id);
                Serial.print(F(" | cooldown="));
                Serial.println(cooldown);
              #endif
            }
          }
        }

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
  // 8)Thermostat Override logic (always runs)
  // ---------------------------
  #if THERMOSTAT_ENABLED
    // ============================================================
    // 🧠 THERMOSTAT CONTROL SYSTEM
    // ------------------------------------------------------------
    // • Entire logic disabled if THERMOSTAT_ENABLED == false
    // • Each thermostat controlled by its own switch:
    //     → Station 0 thermostat switch index 22 (LED pair 22)
    //     → Station 4 thermostat switch index 24 (LED pair 23)
    // • Overrides selected main-controller switches when active.
    // ============================================================

    // --- Enable switches (active-high logical via stableState[]) ---
    thermoEnable1 = stableState[IDX_THERM1_EN]; // Station 0 thermostat enable
    thermoEnable2 = stableState[IDX_THERM2_EN]; // Station 4 thermostat enable

    // --- Debounced thermostat signals ---
    thermoSignal1 = readThermoDebounced(0, A3, now);  // Station 0 sends on A3
    thermoSignal2 = readThermoDebounced(1, A4, now);  // Station 4 sends on A4

    // --- LED pairs behavior ---
    // OFF when switch OFF; when ON => RED if signal LOW, GREEN if signal HIGH
    if (!thermoEnable1) {
      LED_PAIR(LEDPAIR_THERM1, LOW, LOW);
    } else {
      LED_PAIR(LEDPAIR_THERM1, thermoSignal1 ? LOW : HIGH, thermoSignal1 ? HIGH : LOW);
    }

    if (!thermoEnable2) {
      LED_PAIR(LEDPAIR_THERM2, LOW, LOW);
    } else {
      LED_PAIR(LEDPAIR_THERM2, thermoSignal2 ? LOW : HIGH, thermoSignal2 ? HIGH : LOW);
    }

    // --- Apply overrides only when enabled AND signal is HIGH ---
    // Station 0 thermostat (A3 HIGH) -> force indexes 2, 9, 14 HIGH
    if (thermoEnable1 && thermoSignal1) {
      stableState[2]  = 1;
      stableState[9]  = 1;
      stableState[14] = 1;
    }

    // Station 4 thermostat (A4 HIGH) -> force index 17 HIGH
    if (thermoEnable2 && thermoSignal2) {
      stableState[17] = 1;
    }

    #if DEBUG_SERIAL
      Serial.print(F("[THERMO] en1=")); Serial.print(thermoEnable1);
      Serial.print(F(" sig1="));         Serial.print(thermoSignal1);
      Serial.print(F(" | en2="));        Serial.print(thermoEnable2);
      Serial.print(F(" sig2="));         Serial.println(thermoSignal2);
    #endif
  #else
    // ============================================================
    // ❌ THERMOSTAT SYSTEM DISABLED
    // Turn off thermostat LEDs and prevent overrides.
    // ============================================================
    LED_PAIR(LEDPAIR_THERM1, LOW, LOW);
    LED_PAIR(LEDPAIR_THERM2, LOW, LOW);
  #endif

  updateBuzzer(now);
}







// ============================================================
// 🔧 SECTION: HELPER FUNCTIONS
// ============================================================

// -------------------------------------------------------------------
// FUNCTION: digitalWriteAll()
// PURPOSE : Writes the same logic state to a contiguous LED array.
//           Used for bulk on/off control (e.g., link down blink).
// -------------------------------------------------------------------
void digitalWriteAll(const uint8_t* pins, uint8_t count, bool state) {
  for (uint8_t i = 0; i < count; i++) digitalWrite(pins[i], state);
}

// -------------------------------------------------------------------
// Robust MCP23017 interrupt handlers
// Prevents event loss when multiple bits change quickly.
// -------------------------------------------------------------------
void readMcpA() {
  // Continue reading as long as INT line remains low
  while (digitalRead(MCP_INTA_PIN) == LOW) {
    mcpStateA = mcp.readGPIO(0);   // read Port A
    delayMicroseconds(50);        // small debounce to let INT settle
  }
  mcpIntA_Flag = false;
}

void readMcpB() {
  while (digitalRead(MCP_INTB_PIN) == LOW) {
    mcpStateB = mcp.readGPIO(1);   // read Port B
    delayMicroseconds(50);
  }
  mcpIntB_Flag = false;
}

// -------------------------------------------------------------------
// FUNCTION: readThermoDebounced()
// PURPOSE : Samples analog input pins (A3/A4) for thermostat signals,
//           applies debounce filtering, and returns stable logic level.
// -------------------------------------------------------------------
bool readThermoDebounced(uint8_t index, uint8_t pin, uint32_t now) {
  bool raw = digitalRead(pin);
    if (raw != thermoFiltered[index] && (now - lastThermoReadMs[index] >= THERMO_DEBOUNCE_MS)) {
    thermoFiltered[index] = raw;
  }
  lastThermoReadMs[index] = now;
  return thermoFiltered[index];
}


// -------------------------------------------------------------------
// FUNCTION: updateBuzzer()
// PURPOSE : Handles buzzer queue processing and LED synchronization.
//           Plays per-station alarm patterns and manages blinking phase.
// -------------------------------------------------------------------
void updateBuzzer(uint32_t now) {
  // --- Read Buzzer Enable Switch (active high logic) ---
  bool buzzerSwitch = stableState[IDX_BUZZER_EN];
  if (!buzzerSwitch) {
    // Switch OFF → silence and clear queue
    digitalWrite(PIN_BUZZER, LOW);
    LED_PAIR(LEDPAIR_BUZZER, LOW, HIGH);
    for (uint8_t s = 0; s < NUM_STATIONS; s++) lastQueuedMs[s] = 0;
    buzzerActive = false;
    buzzerHead = buzzerTail = 0; // clear queue
    return;
  }

  // --- If no active pattern, pop next queued station ---
  if (!buzzerActive && !buzzerQueueEmpty()) {
    if (currentPattern >= 4) { buzzerActive = false; return; }
    currentPattern = buzzerQueuePop() - 1;  // Station 1–4 → index 0–3
    buzzerActive = true;
    beepStep = 0;
    buzzerOn = false;
    beepTimer = now;
  }

  if (buzzerActive) {
    const BeepPattern &p = STATION_BEEP[currentPattern];
    uint16_t dur = p.baseDur;

    if (buzzerOn) {
      // currently ON: time to stop?
      if (now - beepTimer >= dur) {
        digitalWrite(PIN_BUZZER, LOW);
        LED_PAIR(LEDPAIR_BUZZER, LOW, LOW);
        buzzerOn = false;
        beepTimer = now;
        beepStep++;
      }
    } else {
      // currently OFF
      if (beepStep < p.count * 2 - 1 && (now - beepTimer >= dur)) {
        // start next beep
        digitalWrite(PIN_BUZZER, HIGH);
        LED_PAIR(LEDPAIR_BUZZER, HIGH, LOW);
        buzzerOn = true;
        beepTimer = now;
      } else if (beepStep >= p.count * 2 - 1) {
        // finished this pattern
        digitalWrite(PIN_BUZZER, LOW);
        LED_PAIR(LEDPAIR_BUZZER, LOW, HIGH);
        buzzerActive = false;
        beepTimer = now + 400;  // 400 ms pause before next queued pattern
      }
    }
  } else {
    // idle: steady green
    LED_PAIR(LEDPAIR_BUZZER, LOW, HIGH);
  }

  // --- Update global blink phase every BUZZER_BLINK_MS ---
  if (buzzerActive && (now - lastBuzzerBlinkMs >= BUZZER_BLINK_MS)) {
    lastBuzzerBlinkMs = now;
    buzzerBlinkPhase = !buzzerBlinkPhase;
  }
}


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

// --- Load Station Enable/Disable State from EEPROM ---
// -------------------------------------------------------------------
// FUNCTION: loadStationStatesFromEEPROM()
// PURPOSE : Loads station enable/disable flags from EEPROM,
//           validating data and falling back to defaults if invalid.
// -------------------------------------------------------------------
void loadStationStatesFromEEPROM() {
  for (uint8_t i = 0; i < EEPROM_STATION_COUNT; i++) {
    uint8_t val = EEPROM.read(EEPROM_STATION_BASE + i);
    if (val <= 1) {
      stationEnabled[i] = (val == 1);
    } else {
      stationEnabled[i] = true;
      EEPROM.update(EEPROM_STATION_BASE + i, 1); // auto-fix invalid data
    }
  }

  #if DEBUG_SERIAL
  Serial.println(F("[EEPROM] Loaded station enable states:"));
  for (uint8_t i = 0; i < EEPROM_STATION_COUNT; i++) {
    Serial.print(F("[EEPROM] Station "));
    Serial.print(i);
    Serial.print(F(": "));
    Serial.println(stationEnabled[i] ? F("ENABLED") : F("DISABLED"));
  }
  #endif
}


// --------------------------------------------------------------
// 🎰 Vegas Mode LED Test Sequence
// -------------------------------------------------------------------
// FUNCTION: runVegasMode()
// PURPOSE : Sequentially flashes all LED pairs (red/green) for
//           verification during boot. Optional cosmetic feature.
// -------------------------------------------------------------------
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
        LED_PAIR(idx, HIGH, LOW);
      }
      delay(200);
      for (uint8_t j = 0; j < stationPairCount[st]; j++) {
        uint8_t idx = startIndex + j;
        LED_PAIR(idx, LOW, HIGH);
      }
      delay(200);
    }
    // turn off all LEDs for this station before next
    for (uint8_t j = 0; j < stationPairCount[st]; j++) {
      uint8_t idx = startIndex + j;
      LED_PAIR(idx, LOW, LOW);
    }
    startIndex += stationPairCount[st];
  }

  delay(200);

  // --- 4️⃣ Global RED/GREEN flashes ---
  for (uint8_t f = 0; f < VEGAS_FLASHES; f++) {
    // all RED
    for (uint8_t i = 0; i < NUM_LED_PAIRS; i++) {
      LED_PAIR(i, HIGH, LOW);
    }
    delay(300);
    // all GREEN
    for (uint8_t i = 0; i < NUM_LED_PAIRS; i++) {
      LED_PAIR(i, LOW, HIGH);
    }
    delay(300);
  }

  // --- turn everything off ---
  for (uint8_t i = 0; i < NUM_LED_PAIRS; i++) {
    LED_PAIR(i, LOW, LOW);
  }

  #if DEBUG_SERIAL
    Serial.println(F("[VEGAS] LED test complete."));
  #endif
}

// ============================================================
// ✅ END OF FILE
// ============================================================