
void setup() {
  Serial.begin(115200);
  while(!Serial);
  Serial.println(F("Testing A1–A6 as digital inputs..."));
  
  for (uint8_t p = A1; p <= A5; p++) {
    pinMode(p, INPUT_PULLUP);
  }
  for (uint8_t p = A6; p <= A7; p++) {
    pinMode(p, INPUT_PULLUP);
  }
}

void loop() {
  for (uint8_t p = A1; p <= A5; p++) {
    int val = digitalRead(p);
    Serial.print(F("A"));
    Serial.print(p - A0);
    Serial.print(F(": "));
    Serial.print(val ? "HIGH " : "LOW  ");
  }
  for (uint8_t p = A6; p <= A7; p++) {
    
    static bool state = false;
    int v = analogRead(p);
    if (!state && v > 300) state = true;     // press
    if (state && v < 180) state = false;     // release
    Serial.print(F("v = "));
    Serial.print(v);

    Serial.print(F(" A"));
    Serial.print(p - A0);
    Serial.print(F(": "));
    Serial.print(state ? "HIGH " : "LOW  ");
  }
  Serial.println();
  delay(500);
}