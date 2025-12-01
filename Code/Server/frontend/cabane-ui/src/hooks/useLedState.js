import { useSocket } from '../contexts/SocketContext';

export function useLedState(idx, feedbackMap, specialType) {
    const { systemState } = useSocket();
    const { virtualSwitches, physicalSwitches, stationFeedback, controller } = systemState;

    // 1. Determine Switch Position (Command)
    // If User/Server is driving, look at Virtual. If Cabane, look at Physical.
    // Actually, for LED feedback, we usually care about the "Active Command"
    const isSwitchOn = (controller === 'CABANE') ? !!physicalSwitches[idx] : !!virtualSwitches[idx];

    // 2. Determine Feedback State
    let isFeedbackOn = false; // "On" means the machinery is running (Active Low logic usually)

    if (feedbackMap) {
        const { st, bit } = feedbackMap;
        // In C++, Bit 0 = ON (Active Low).
        // Let's read the raw bit.
        const rawBit = (stationFeedback[st] >> bit) & 1;
        isFeedbackOn = (rawBit === 0);
    }

    // 3. Special Logic (Thermostats & Buzzer)
    if (specialType === 'TH1') {
        // Station 0, Bit 3
        const thActive = ((stationFeedback[0] >> 3) & 1) === 0; // Active Low

        if (!isSwitchOn) return 'off'; // Switch Off -> Light Off
        return thActive ? 'green' : 'red'; // On+Cold=Green, On+Warm=Red
    }

    if (specialType === 'TH2') {
        // Station 4, Bit 3
        const thActive = ((stationFeedback[4] >> 3) & 1) === 0;

        if (!isSwitchOn) return 'off';
        return thActive ? 'green' : 'red';
    }

    if (specialType === 'BUZZER') {
        return isSwitchOn ? 'green' : 'red';
    }

    // 4. Standard Logic (Pumps/Valves)
    // Vacuum Alarm: Switch ON but Feedback OFF -> Flash Red?
    // For now, let's replicate standard status:
    if (isFeedbackOn) return 'green';

    // If Switch is ON but Feedback is OFF -> Alarm condition (Red)
    return 'red';
}