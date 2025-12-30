import { useSocket } from '../contexts/SocketContext';

// Indices of switches that monitor Vacuum
const VACUUM_INDICES = [2, 3, 9, 14, 17];

export function useLedState(idx, feedbackMap, specialType) {
    const { systemState, siteSettings } = useSocket();
    const { virtualSwitches, physicalSwitches, stationFeedback, stationLastSeen, controller, globalVacuumAlarm } = systemState;

    // --- 1. NEVER SEEN CHECK ---
    if (feedbackMap) {
        const { st } = feedbackMap;
        if (stationLastSeen[st] === 0) return 'off';
    }

    // Thermostats (Hardcoded Dependencies)
    if (specialType === 'TH1' && stationLastSeen[0] === 0) return 'off'; // ST0
    if (specialType === 'TH2' && stationLastSeen[4] === 0) return 'off'; // ST4

    // --- 2. DETERMINE SWITCH POSITION ---
    const isSwitchOn = (controller === 'CABANE') ? !!physicalSwitches[idx] : !!virtualSwitches[idx];

    // --- 3. DETERMINE FEEDBACK STATE ---
    let isFeedbackOn = false;

    if (feedbackMap) {
        const { st, bit } = feedbackMap;

        let rawBit = (stationFeedback[st] >> bit) & 1;
        const ledMask = parseInt(siteSettings.led_logic_mask || '0');

        // ✅ FIX: Invert manually to keep it a NUMBER (0 or 1)
        // Previous error: using !rawBit made it a boolean, breaking strict equality checks
        if ((ledMask >> idx) & 1) {
            rawBit = (rawBit === 1 ? 0 : 1);
        }

        // Logic is Active Low (0 = ON/Running, 1 = OFF/Stopped)
        isFeedbackOn = (rawBit === 0);
    }

    // --- 4. SPECIAL LOGIC (Buzzer & Thermostats) ---

    // A. BUZZER (Index 21)
    if (specialType === 'BUZZER') {
        if (globalVacuumAlarm) return 'blink-red';
        return isSwitchOn ? 'green' : 'red';
    }

    // B. THERMOSTATS
    if (specialType === 'TH1') { // ST0
        let rawBit = (stationFeedback[0] >> 3) & 1; // Bit 3
        const ledMask = parseInt(siteSettings.led_logic_mask || '0');

        // ✅ FIX: Invert Sensor Logic (NO vs NC)
        if ((ledMask >> 22) & 1) {
            rawBit = (rawBit === 1 ? 0 : 1);
        }

        // Logic: 0 = Active/Cold, 1 = Idle/Warm
        const thActive = (rawBit === 0);

        if (!isSwitchOn) return 'off';
        return thActive ? 'green' : 'red';
    }

    if (specialType === 'TH2') { // ST4
        let rawBit = (stationFeedback[4] >> 3) & 1; // Bit 3
        const ledMask = parseInt(siteSettings.led_logic_mask || '0');

        // ✅ FIX: Invert Sensor Logic
        if ((ledMask >> 23) & 1) {
            rawBit = (rawBit === 1 ? 0 : 1);
        }

        const thActive = (rawBit === 0);

        if (!isSwitchOn) return 'off';
        return thActive ? 'green' : 'red';
    }

    // --- 5. ALARM LOGIC (Vacuum Pumps) ---
    if (VACUUM_INDICES.includes(idx)) {
        if (isSwitchOn && !isFeedbackOn) {
            return 'blink-red';
        }
    }

    // --- 6. STANDARD LOGIC ---
    if (isFeedbackOn) return 'green';

    return 'red'; // Default OFF/Standby
}