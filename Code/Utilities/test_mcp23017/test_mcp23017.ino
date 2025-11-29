#include <Wire.h>
#include "Adafruit_MCP23X17.h"

// ======================================================
// 🧩 CONFIGURATION
// ======================================================
#define MCP_ADDR 0x27      // A0–A2 = GND → 0x20
#define INT_PIN_A 18       // Connected to INTA
#define INT_PIN_B 19       // Connected to INTB

// ======================================================
// 🧩 GLOBAL OBJECTS & FLAGS
// ======================================================
Adafruit_MCP23X17 mcp;
volatile bool intA_flag = false;
volatile bool intB_flag = false;

// ======================================================
// 🧩 INTERRUPT HANDLERS
// ======================================================
void onMcpIntA() { intA_flag = true; }
void onMcpIntB() { intB_flag = true; }

// ======================================================
// 🧩 SETUP
// ======================================================
void setup() {
  Serial.begin(115200);
  while (!Serial);
  Serial.println(F("[MCP] Interrupt test starting..."));

  Wire.begin();

  if (!mcp.begin_I2C(MCP_ADDR)) {
    Serial.println(F("[MCP] ERROR: MCP23017 not found!"));
    while (1);
  }
  Serial.println(F("[MCP] MCP23017 detected."));

  // GPA0–GPA3 → outputs (for LEDs)
  for (uint8_t i = 0; i < 7; i++) {
    mcp.pinMode(i, OUTPUT);
  }

  // GPB0–GPB3 → inputs with pull-ups and interrupt-on-change
  for (uint8_t i = 8; i < 12; i++) {
    mcp.pinMode(i, INPUT_PULLUP);
    mcp.setupInterruptPin(i, CHANGE); // trigger on change
  }

  // Enable mirrored interrupts (both ports can signal INT pins)
  mcp.setupInterrupts(true, false, LOW);  // mirrored, not open-drain, active-low

  // Attach Arduino interrupts
  pinMode(INT_PIN_A, INPUT_PULLUP);
  pinMode(INT_PIN_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(INT_PIN_A), onMcpIntA, FALLING);
  attachInterrupt(digitalPinToInterrupt(INT_PIN_B), onMcpIntB, FALLING);

  Serial.println(F("[MCP] Pin configuration complete."));
  Serial.println(F("Toggle GPB0–GPB3 to trigger interrupts."));
}

// ======================================================
// 🧩 LOOP
// ======================================================
void loop() {
  static uint32_t lastBlink = 0;
  uint32_t now = millis();

  // Blink outputs GPA0–3 sequentially
  if (now - lastBlink > 200) {
    static uint8_t i = 0;
    mcp.digitalWrite(i, HIGH);
    delay(100);
    mcp.digitalWrite(i, LOW);
    i = (i + 1) % 4;
    lastBlink = now;
  }

  // Handle interrupts
  if (intA_flag) {
    intA_flag = false;
    uint8_t pin = mcp.getLastInterruptPin();
    uint8_t val = mcp.digitalRead(pin); // get current pin state
    Serial.print(F("[INTA] Pin "));
    Serial.print(pin);
    Serial.print(F(" changed to "));
    Serial.println(val);
  }

  if (intB_flag) {
    intB_flag = false;
    uint8_t pin = mcp.getLastInterruptPin();
    uint8_t val = mcp.digitalRead(pin);
    Serial.print(F("[INTB] Pin "));
    Serial.print(pin);
    Serial.print(F(" changed to "));
    Serial.println(val);
  }
}