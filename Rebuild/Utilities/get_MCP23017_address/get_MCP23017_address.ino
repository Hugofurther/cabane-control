#include <Wire.h>

void setup() {
  Serial.begin(115200);
  while (!Serial);
  Serial.println(F("\n[SCAN] Starting I2C device scan..."));
  Wire.begin();

  byte count = 0;
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print(F("Found device at 0x"));
      Serial.println(addr, HEX);
      count++;
      delay(5);
    }
  }

  if (count == 0) Serial.println(F("No I2C devices found!"));
  else Serial.println(F("Scan complete."));
}

void loop() {}