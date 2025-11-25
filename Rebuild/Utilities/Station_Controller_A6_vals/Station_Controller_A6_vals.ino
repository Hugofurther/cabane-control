void setup() {
  Serial.begin(115200);
}

void loop() {
  int val = analogRead(A6);
  float voltage = val * (5.0 / 1023.0);
  
  Serial.print("Analog Value: ");
  Serial.print(val);
  Serial.print("  (Voltage: ");
  Serial.print(voltage);
  Serial.println("V)");
  
  delay(500);
}