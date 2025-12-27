import { useSocket } from '../contexts/SocketContext';

// Indices of switches that monitor Vacuum
const VACUUM_INDICES = [2, 3, 9, 14, 17];

export function useLedState(idx, feedbackMap, specialType) {
    // ✅ ADDED: siteSettings to get the led_logic_mask
    const { systemState, siteSettings } = useSocket();
    const { virtualSwitches, physicalSwitches, stationFeedback, stationLastSeen, controller, globalVacuumAlarm } = systemState;

    // --- 1. NEVER SEEN CHECK ---
    // If the station has never connected since server boot, force LED OFF (Grey).

    // Standard Controls with Feedback Map
    if (feedbackMap) {
        const { st } = feedbackMap;
        if (stationLastSeen[st] === 0) return 'off';
    }

    // Thermostats (Hardcoded Dependencies)
    if (specialType === 'TH1' && stationLastSeen[0] === 0) return 'off'; // ST0
    if (specialType === 'TH2' && stationLastSeen[4] === 0) return 'off'; // ST4

    // --- 2. DETERMINE SWITCH POSITION ---
    // If Cabane is driving, look at physical. If User/Server, look at Virtual.
    const isSwitchOn = (controller === 'CABANE') ? !!physicalSwitches[idx] : !!virtualSwitches[idx];

    // --- 3. DETERMINE FEEDBACK STATE ---
    let isFeedbackOn = false;

    if (feedbackMap) {
        const { st, bit } = feedbackMap;

        // ✅ CHANGED: Read raw bit, then check for inversion
        let rawBit = (stationFeedback[st] >> bit) & 1;

        // Check Global LED Logic Mask (Loaded from DB/AdminPanel)
        const ledMask = parseInt(siteSettings.led_logic_mask || '0');

        // If the bit for this switch index is set, FLIP the raw feedback
        if ((ledMask >> idx) & 1) {
            rawBit = (rawBit === 1 ? 0 : 1);
        }

        // Logic is Active Low (0 = ON/Running, 1 = OFF/Stopped)
        isFeedbackOn = (rawBit === 0);
    }

    // --- 4. SPECIAL LOGIC (Buzzer & Thermostats) ---

    // A. BUZZER (Index 21)
    if (specialType === 'BUZZER') {
        // If Global Alarm is active -> BLINK RED
        if (globalVacuumAlarm) return 'blink-red';

        // Otherwise: Green if Enabled, Red if Muted
        return isSwitchOn ? 'green' : 'red';
    }

    // B. THERMOSTATS
    // Note: Thermostats (22, 23) are not in your list of configurable inversions (2-20),
    // so we leave their internal logic as-is (standard active-low check).
    if (specialType === 'TH1') { // ST0
        // Check Temp Sensor on ST0 Bit 3
        const thActive = ((stationFeedback[0] >> 3) & 1) === 0;

        if (!isSwitchOn) return 'off'; // Disabled
        return thActive ? 'green' : 'red'; // Active(Cold)=Green, Idle(Warm)=Red
    }

    if (specialType === 'TH2') { // ST4
        // Check Temp Sensor on ST4 Bit 3
        const thActive = ((stationFeedback[4] >> 3) & 1) === 0;

        if (!isSwitchOn) return 'off';
        return thActive ? 'green' : 'red';
    }

    // --- 5. ALARM LOGIC (Vacuum Pumps) ---
    // If it's a Vacuum Switch AND Command is ON AND Feedback is OFF -> Alarm
    // Note: isFeedbackOn now accounts for the inversion, so this alarm logic remains correct.
    if (VACUUM_INDICES.includes(idx)) {
        if (isSwitchOn && !isFeedbackOn) {
            return 'blink-red';
        }
    }

    // --- 6. STANDARD LOGIC ---
    if (isFeedbackOn) return 'green';

    return 'red'; // Default OFF/Standby
}