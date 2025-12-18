/*
  ==============================================================
  STATION CONTROLLER — FIRMWARE v5.2-ConflictCheck

  UPDATES:
  - Auto-Increment ID on conflict (Arbiter Logic)
  - Uses Port 8888 for Handshake (Command Port)
  - Uses Port 8889 for Feedback
  ==============================================================
*/

#define FIRMWARE_VERSION "v5.2-ConflictCheck"
#define HAS_TM1637 1
#define DEBUG_SERIAL 1

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

const uint8_t OUT_PINS[6] = {2, 3, 4, 5, 6, 7};
const uint8_t IN_PINS[5] = {A1, A2, A3, A4, A5};
#define IN_PIN_A6 A6
#define BTN_PIN A7

#define ETH_CS 10
#define ETH_RST A0
byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0x02, 0x10};
IPAddress ipBroadcast(192, 168, 1, 255);

// ✅ PORTS
const uint16_t PORT_CMD = 8888; // Listen here, Send Handshake here
const uint16_t PORT_FB = 8889;  // Send Feedback here

EthernetUDP Udp;

uint8_t STATION_ID = 0;
uint8_t lastFeedbackBits = 0;
uint8_t pendingID = 0;
bool reconfigPending = false;
uint32_t lastButtonTime = 0;
uint32_t lastCmdMs = 0;
const uint16_t CMD_WATCHDOG_MS = 4000;
const uint16_t RECONFIG_DELAY_MS = 1500;

enum DisplayMode
{
  DISP_NORMAL,
  DISP_ERROR,
  DISP_LINK,
  DISP_DISABLED,
  DISP_CHECKING
};
DisplayMode displayMode = DISP_NORMAL;
bool displayFlash = false;
uint32_t lastDisplayUpdate = 0;

uint8_t xorChecksum(const uint8_t *data, uint8_t len)
{
  uint8_t c = 0;
  for (uint8_t i = 0; i < len; i++)
    c ^= data[i];
  return c;
}

void initEthernet(bool fullReset, uint8_t tempId)
{
  if (fullReset)
  {
    SPI.begin();
    pinMode(ETH_CS, OUTPUT);
    digitalWrite(ETH_CS, HIGH);
    pinMode(ETH_RST, OUTPUT);
    digitalWrite(ETH_RST, LOW);
    delay(200);
    digitalWrite(ETH_RST, HIGH);
    delay(800);
  }
  // IP depends on ID
  IPAddress localIp(192, 168, 1, 210 + tempId);
  mac[5] = 0x10 + tempId;
  Ethernet.init(ETH_CS);
  Ethernet.begin(mac, localIp);
  Udp.begin(PORT_CMD); // Listen on 8888 for Commands & Conflict Responses
}

// ✅ NEW: Conflict Check Logic
// Returns TRUE if ID is taken (Conflict)
bool isIdTaken(uint8_t candidate)
{
#if HAS_TM1637
  display.clear();
  uint8_t seg[] = {0x50, 0x50, 0x50, 0x50}; // "r r r r" (Scanning)
  display.setSegments(seg);
#endif

  // 1. Send Check Request [0xAD, ID, Cks]
  uint8_t req[3] = {0xAD, candidate, (uint8_t)(0xAD ^ candidate)};
  Udp.beginPacket(ipBroadcast, PORT_CMD); // Send to 8888
  Udp.write(req, 3);
  Udp.endPacket();

  // 2. Wait for Denial (200ms window)
  uint32_t tStart = millis();
  while (millis() - tStart < 200)
  {
    if (Udp.parsePacket())
    {
      uint8_t buf[10];
      int n = Udp.read(buf, 10);
      // Expect Denial: [0xAE, ID, ..., Cks]
      if (n >= 2 && buf[0] == 0xAE && buf[1] == candidate)
      {
        return true; // Conflict Confirmed!
      }
    }
  }
  return false; // No denial = Safe
}

// ✅ WRAPPER: Find Next Free ID
void findAndApplyID(uint8_t startId)
{
  uint8_t current = startId;
  bool found = false;
  int attempts = 0;

  while (!found && attempts < 6)
  {
    initEthernet(false, current); // Init with candidate IP
    delay(50);                    // Let link settle

    if (!isIdTaken(current))
    {
      found = true;
    }
    else
    {
      current++;
      if (current > 5)
        current = 0;
      attempts++;
    }
  }

  STATION_ID = current;
  pendingID = STATION_ID;
  saveStationID(STATION_ID);
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

void applyRelays(uint8_t bits)
{
  for (uint8_t i = 0; i < 6; i++)
    digitalWrite(OUT_PINS[i], (bits & (1 << i)) ? HIGH : LOW);
}
uint8_t readInputs()
{
  uint8_t bits = 0;
  for (uint8_t i = 0; i < 5; i++)
  {
    if (digitalRead(IN_PINS[i]) == LOW)
      bits |= (1 << i);
  }
  int val = analogRead(IN_PIN_A6);
  if (val < 850)
  {
    if (val < 500)
      bits |= (1 << 5) | (1 << 6);
    else if (val < 605)
      bits |= (1 << 5);
    else
      bits |= (1 << 6);
  }
  return bits;
}

void updateDisplay(uint32_t now)
{
#if HAS_TM1637
  if (now - lastDisplayUpdate < 500)
    return;
  lastDisplayUpdate = now;
  displayFlash = !displayFlash;

  if (reconfigPending)
  {
    display.clear();
    display.showNumberDec(pendingID, false, 1, 0);
    return;
  }

  if (displayMode == DISP_LINK)
  {
    if (displayFlash)
    {
      const uint8_t ln[] = {0x38, 0x54};
      display.setSegments(ln, 2, 1);
    }
    else
      display.clear();
    return;
  }
  if (displayMode == DISP_DISABLED)
  {
    if (displayFlash)
    {
      const uint8_t err[] = {0x79, 0x50, 0x50};
      display.setSegments(err, 3, 0);
      display.showNumberDec(STATION_ID, false, 1, 3);
    }
    else
      display.clear();
    return;
  }
  if (displayMode == DISP_NORMAL)
  {
    display.clear();
    display.showNumberDec(STATION_ID, false, 1, 3);
  }
  else if (displayMode == DISP_ERROR)
  {
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

void setup()
{
  wdt_disable();
  delay(500);
  pinMode(BTN_PIN, INPUT);
  for (uint8_t p : OUT_PINS)
    pinMode(p, OUTPUT);
  for (uint8_t p : IN_PINS)
    pinMode(p, INPUT_PULLUP);
  loadStationID();

#if HAS_TM1637
  display.setBrightness(0x0F);
  display.showNumberDec(STATION_ID, false, 1, 3);
#endif

  // ✅ INITIAL CONFLICT CHECK (Full Reset)
  initEthernet(true, STATION_ID);
  delay(100);
  findAndApplyID(STATION_ID);

  wdt_enable(WDTO_4S);
}

void loop()
{
  wdt_reset();
  uint32_t now = millis();

  if (analogRead(BTN_PIN) < 200)
  {
    if (now - lastButtonTime > 300)
    {
      pendingID = (pendingID + 1) % 6;
      reconfigPending = true;
      lastButtonTime = now;
      display.clear();
      display.showNumberDec(pendingID, false, 1, 0);
    }
  }
  else if (reconfigPending && (now - lastButtonTime > 1500))
  {
    // ✅ MANUAL CHANGE CONFLICT CHECK
    findAndApplyID(pendingID);
    reconfigPending = false;
  }

  if (Ethernet.linkStatus() == LinkOFF)
  {
    displayMode = DISP_LINK;
  }
  else
  {
    int packets = 0;
    while (Udp.parsePacket() > 0 && packets < 20)
    {
      packets++;
      uint8_t buf[32];
      int n = Udp.read(buf, sizeof(buf));

      // Global Command (0xBB)
      if (n >= 10 && buf[0] == 0xBB && xorChecksum(buf, n - 1) == buf[n - 1])
      {
        if ((3 + STATION_ID) < (n - 1))
        {
          uint8_t cmd = buf[3 + STATION_ID];
          if (cmd & 0x80)
          {
            displayMode = DISP_DISABLED;
          }
          else
          {
            displayMode = DISP_NORMAL;
            applyRelays(cmd & 0x7F);
          }
          lastCmdMs = now;
        }
      }
    }
    // Watchdog
    if (displayMode != DISP_DISABLED && (now - lastCmdMs > CMD_WATCHDOG_MS))
    {
      displayMode = DISP_ERROR;
      if (now - lastCmdMs > 10000)
      {
        initEthernet(false, STATION_ID);
        lastCmdMs = now;
      }
    }
  }

  uint8_t currentBits = readInputs();
  static uint32_t lastTxTime = 0;
  if ((currentBits != lastFeedbackBits) || (now - lastTxTime > 500))
  {
    lastFeedbackBits = currentBits;
    lastTxTime = now;
    uint8_t invBits = ~currentBits;
    uint8_t fb[5] = {0xAC, STATION_ID, invBits, 0x00, 0};
    fb[4] = xorChecksum(fb, 4);

    // ✅ SEND TO FEEDBACK PORT (8889)
    Udp.beginPacket(ipBroadcast, PORT_FB);
    Udp.write(fb, 5);
    Udp.endPacket();
  }
  updateDisplay(now);
}