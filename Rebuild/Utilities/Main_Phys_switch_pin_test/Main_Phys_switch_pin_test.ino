const uint8_t testPins[] = {62, 63, 64, 65, 66, 67, 68, 69};

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < 8; i++) {
    pinMode(testPins[i], INPUT_PULLUP);
  }
}

void loop() {
  for (uint8_t i = 0; i < 8; i++) {
    Serial.print(digitalRead(testPins[i]));
  }
  Serial.println();
  delay(500);
}