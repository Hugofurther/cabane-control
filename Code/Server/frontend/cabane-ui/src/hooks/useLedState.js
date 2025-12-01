import { useSocket } from '../contexts/SocketContext';

// Indices of switches that monitor Vacuum
const VACUUM_INDICES = [2, 3, 9, 14, 17];

export function useLedState(idx, feedbackMap, specialType) {
    const { systemState } = useSocket();
    const { virtualSwitches, physicalSwitches, stationFeedback, controller, globalVacuumAlarm } = systemState;

    // 1. Determine Switch Position (Command)
    // If Cabane is driving, we look at physical. If User/Server, we look at Virtual.
    const isSwitchOn = (controller === 'CABANE') ? !!physicalSwitches[idx] : !!virtualSwitches[idx];

    // 2. Determine Feedback State
    let isFeedbackOn = false;

    if (feedbackMap) {
        const { st, bit } = feedbackMap;
        const rawBit = (stationFeedback[st] >> bit) & 1;
        // 0 = Active/On, 1 = Inactive/Off
        isFeedbackOn = (rawBit === 0);
    }

    // --- ALARM LOGIC ---

    // A. BUZZER (Index 21)
    if (specialType === 'BUZZER') {
        // If Global Alarm is active -> BLINK RED
        if (globalVacuumAlarm) return 'blink-red';

        // Otherwise: Green if Enabled, Red if Muted
        return isSwitchOn ? 'green' : 'red';
    }

    // B. THERMOSTATS
    if (specialType === 'TH1') { // ST0
        const thActive = ((stationFeedback[0] >> 3) & 1) === 0;
        if (!isSwitchOn) return 'off';
        return thActive ? 'green' : 'red';
    }

    if (specialType === 'TH2') { // ST4
        const thActive = ((stationFeedback[4] >> 3) & 1) === 0;
        if (!isSwitchOn) return 'off';
        return thActive ? 'green' : 'red';
    }

    // C. VACUUM PUMPS (Specific Alarm)
    // If it's a Vacuum Switch AND Command is ON AND Feedback is OFF -> Alarm
    if (VACUUM_INDICES.includes(idx)) {
        if (isSwitchOn && !isFeedbackOn) {
            return 'blink-red';
        }
    }

    // 3. Standard Logic
    if (isFeedbackOn) return 'green';

    return 'red'; // Default OFF/Standby
}