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

  updateBuzzer(now);
}

// ============================================================
// ✅ END OF FILE
// ============================================================