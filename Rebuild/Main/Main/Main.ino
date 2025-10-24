

// ---------------- GLOBAL SETTINGS ----------------
#define THERMOSTAT_ENABLED true // master enable for thermostat system

// --- LED pairs ---
#define NUM_LED_PAIRS 24

#define LEDPAIR_THERM1 22
#define LEDPAIR_THERM2 23

// ============================================================
// 🧩 SECTION: CONSTANTS & TIMING
// ============================================================
const uint16_t DEBOUNCE_MS = 25;

const uint16_t THERMO_DEBOUNCE_MS = 50; // debounce duration

// ============================================================
// 🧩 SECTION: VACUUM ALARM & BUZZER COORDINATION
// ============================================================

// Define mapping for each vacuum station
const VacuumMap VACUUMS[4] = {
    {{2, 3}, {2, 3}, 1, {0, 1}},         // Station 1
    {{9, 255}, {9, 255}, 2, {0, 255}},   // Station 2
    {{14, 255}, {14, 255}, 3, {0, 255}}, // Station 3
    {{17, 255}, {17, 255}, 4, {0, 255}}  // Station 4
};

// ---- Control switch indices inside stableState[] ----
// (GPB0..7 map to stableState[16..23])
#define IDX_BUZZER_EN 21 // GPB5
#define IDX_THERM1_EN 22 // GPB6
#define IDX_THERM2_EN 23 // GPB7
// ===== Input Switch Pins (24 total) =====

// MCP bit mapping for vacuum switches (for ports A/B)
#define VAC_SW_S2_A_BIT 1 // GPA1volatile bool mcpIntA_Flag
#define VAC_SW_S3_A_BIT 6 // GPA6
#define VAC_SW_S4_B_BIT 1 // GPB1

// ----------------------------- TIMING --------------------------------

uint32_t lastChangeMs[NUM_INPUTS] = {0};
// --- Thermostat signal debouncing ---
uint32_t lastThermoReadMs[2] = {0, 0};
bool thermoFiltered[2] = {false, false}; // filtered logic for A3 (index 0) and A4 (index 1)

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
void loop()
{

  // timing & link tracking
  uint32_t now = millis();
  static uint32_t lastLinkCheck = 0;
  static bool linkDown = false;

  // LED feedback reuse
  uint8_t pair = 0, owner = 0, bitIndex = 0;

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
  for (uint8_t i = 0; i < NUM_INPUTS; i++)
  {
    uint8_t r = digitalRead(PHYS_SW_PINS[i]);
    stableState[i] = !r; // active-low
  }

  // If MCP interrupt flags set, read ports to update remaining 16 inputs
  // -------------------------------------------------------------------
  // FUNCTION: readMcpA() / readMcpB()
  // PURPOSE : Reads GPIO states from MCP23017 when interrupt occurs,
  //           ensuring no change events are lost.
  // -------------------------------------------------------------------
  if (mcpIntA_Flag)
    readMcpA();
  if (mcpIntB_Flag)
    readMcpB();

  // Copy MCP bits into stableState[8..23]
  for (uint8_t b = 0; b < 8; b++)
  {
    stableState[8 + b] = ((mcpStateA & (1 << b)) == 0); // active low
    stableState[16 + b] = ((mcpStateB & (1 << b)) == 0);
  }

#if DEBUG_SERIAL
  for (uint8_t i = 0; i < TOTAL_INPUTS; i++)
  {
    Serial.print(stableState[i]);
    Serial.print(' ');
  }
  Serial.println();

  Serial.print(F("MCP A: "));
  Serial.print(~mcpStateA, BIN);
  Serial.print(F("  MCP B: "));
  Serial.println(~mcpStateB, BIN);
#endif

  // 2) Long-press detection for station enable/disable

  for (id = 0; id < NUM_STATIONS; id++)
  {
    uint8_t idx = stationButtonIndex[id];
    bool pressed = stableState[idx];
    if (pressed && !pressActive[id])
    {
      pressActive[id] = true;
      pressStart[id] = now;
    }
    else if (!pressed && pressActive[id])
    {
      pressActive[id] = false;
    }
    else if (pressed && pressActive[id] && (now - pressStart[id] >= LONGPRESS_MS))
    {
      setStationEnabled(id, !stationEnabled[id]);
      pressActive[id] = false;
#if DEBUG_SERIAL
      Serial.print(F("[TOGGLE] Station "));
      Serial.print(id);
      Serial.print(F(" -> "));
      Serial.println(stationEnabled[id] ? F("ENABLED") : F("DISABLED"));
#endif
    }
  }

  // 4) Heartbeat timeout
  for (id = 0; id < NUM_STATIONS; id++)
  {
    stationOffline[id] = (now - lastHeartbeatMs[id] > HEARTBEAT_TIMEOUT_MS);
  }

  // ----------------VACUUM VISUAL LOGIC ----------------
  anyVacuumAlarm = false; // will drive the buzzer LED behavior

  for (st = 0; st < 4; st++)
  {
    const VacuumMap &v = VACUUMS[st];

    // --- Determine if any vacuum switch for this station is ON ---
    vacSwitch = false;
    for (uint8_t s = 0; s < 2; s++)
    {
      uint8_t idx = v.switchIndex[s];
      if (idx != 255 && stableState[idx])
        vacSwitch = true;
    }

    // --- Determine vacuum signal state (LOW = fault) ---
    vacSignal = false;
    for (uint8_t b = 0; b < 2; b++)
    {
      uint8_t bit = v.bitIndex[b];
      if (bit != 255 && ((stationFeedback[v.stationID] >> bit) & 1))
        vacSignal = true;
    }

    alarmActive = (vacSwitch && !vacSignal);
    if (alarmActive)
      anyVacuumAlarm = true;

    // --- Update LED pairs ---
    for (uint8_t k = 0; k < 2; k++)
    {
      uint8_t led = v.ledPair[k];
      if (led == 255)
        continue;

      if (alarmActive)
      {
        // Blinking red if active alarm and buzzer switch ON
        if (stableState[IDX_BUZZER_EN])
        {
          LED_PAIR(led, buzzerBlinkPhase ? HIGH : LOW, LOW);
        }
        else
        {
          // buzzer switch off → steady red
          LED_PAIR(led, HIGH, LOW);
        }
      }
      else
      {
        // Normal state: red if signal LOW, green if HIGH
        relayOn = vacSignal;
        LED_PAIR(led, relayOn ? LOW : HIGH, relayOn ? HIGH : LOW);
      }
    }
  }

  // ----------------------------- BUZZER LED VISUAL -----------------------------
  bool buzzerSwitchOn = stableState[IDX_BUZZER_EN];

  if (!buzzerSwitchOn)
  {
    // Buzzer switch OFF → solid red
    LED_PAIR(LEDPAIR_BUZZER, HIGH, LOW);
  }
  else if (anyVacuumAlarm)
  {
    // Buzzer switch ON + active vacuum alarm → blinking red
    LED_PAIR(LEDPAIR_BUZZER, buzzerBlinkPhase ? HIGH : LOW, LOW);
  }
  else
  {
    // Buzzer ON + no alarms → steady green
    LED_PAIR(LEDPAIR_BUZZER, LOW, HIGH);
  }

  // 6) Send frames periodically (every SEND_INTERVAL_MS)
  if (now - tSend >= SEND_INTERVAL_MS)
  {
    tSend = now;
    // --- Station 0 ---
    if (stationEnabled[ST0] && !stationOffline[ST0])
    {
      bool s0[2];
      for (uint8_t i = 0; i < 2; i++)
        s0[i] = stableState[i];
      sendSetFrame(ipS0, ST0, packBitsLSB(s0, 2));
    }
    // --- Station 1 ---
    if (stationEnabled[ST1] && !stationOffline[ST1])
    {
      bool s1[6];
      for (uint8_t i = 0; i < 6; i++)
        s1[i] = stableState[2 + i];
      sendSetFrame(ipS1, ST1, packBitsLSB(s1, 6));
    }

    // --- Station 2 ---
    if (stationEnabled[ST2] && !stationOffline[ST2])
    {
      bool s2[4];
      for (uint8_t i = 0; i < 4; i++)
        s2[i] = stableState[8 + i];
      sendSetFrame(ipS2, ST2, packBitsLSB(s2, 4));
    }

    // --- Station 3 ---
    if (stationEnabled[ST3] && !stationOffline[ST3])
    {
      bool s3[4];
      for (uint8_t i = 0; i < 4; i++)
        s3[i] = stableState[12 + i];
      sendSetFrame(ipS3, ST3, packBitsLSB(s3, 4));
    }

    // --- Station 4 ---
    if (stationEnabled[ST4] && !stationOffline[ST4])
    {
      bool s4[3];
      for (uint8_t i = 0; i < 3; i++)
        s4[i] = stableState[16 + i];
      sendSetFrame(ipS4, ST4, packBitsLSB(s4, 3));
    }

    // --- Station 5 ---
    if (stationEnabled[ST5] && !stationOffline[ST5])
    {
      bool s5[2];
      for (uint8_t i = 0; i < 2; i++)
        s5[i] = stableState[19 + i];
      sendSetFrame(ipS5, ST5, packBitsLSB(s5, 2));
    }
  }

  // --- BUZZER VACUUM DETECTION LOGIC (with cooldown) ---
  if (id >= 1 && id <= 4)
  {                                                  // Stations 1–4 only
    vacuumAlarm = !((stationFeedback[id] >> 0) & 1); // bit0 = vacuum
    if (vacuumAlarm)
    {
      uint16_t cooldown = STATION_BEEP[id - 1].baseDur * STATION_BEEP[id - 1].count * 2;
      if (now - lastQueuedMs[id] >= cooldown)
      {
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
  Serial.print(F("[FB ] Station "));
  Serial.print(id);
  Serial.print(F(" bits: "));
  Serial.println(bits, BIN);
#endif
}
else
{
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
thermoSignal1 = readThermoDebounced(0, A3, now); // Station 0 sends on A3
thermoSignal2 = readThermoDebounced(1, A4, now); // Station 4 sends on A4

// --- LED pairs behavior ---
// OFF when switch OFF; when ON => RED if signal LOW, GREEN if signal HIGH
if (!thermoEnable1)
{
  LED_PAIR(LEDPAIR_THERM1, LOW, LOW);
}
else
{
  LED_PAIR(LEDPAIR_THERM1, thermoSignal1 ? LOW : HIGH, thermoSignal1 ? HIGH : LOW);
}

if (!thermoEnable2)
{
  LED_PAIR(LEDPAIR_THERM2, LOW, LOW);
}
else
{
  LED_PAIR(LEDPAIR_THERM2, thermoSignal2 ? LOW : HIGH, thermoSignal2 ? HIGH : LOW);
}

// --- Apply overrides only when enabled AND signal is HIGH ---
// Station 0 thermostat (A3 HIGH) -> force indexes 2, 9, 14 HIGH
if (thermoEnable1 && thermoSignal1)
{
  stableState[2] = 1;
  stableState[9] = 1;
  stableState[14] = 1;
}

// Station 4 thermostat (A4 HIGH) -> force index 17 HIGH
if (thermoEnable2 && thermoSignal2)
{
  stableState[17] = 1;
}

#if DEBUG_SERIAL
Serial.print(F("[THERMO] en1="));
Serial.print(thermoEnable1);
Serial.print(F(" sig1="));
Serial.print(thermoSignal1);
Serial.print(F(" | en2="));
Serial.print(thermoEnable2);
Serial.print(F(" sig2="));
Serial.println(thermoSignal2);
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

// ============================================================
// ✅ END OF FILE
// ============================================================