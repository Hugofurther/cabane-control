// ============================================================
// 🧠 LOGIC ENGINE (State Machine) - v7 INDEPENDENT LOGIC
// ============================================================
const udpService = require('./udp_service');

const state = {
    controller: 'CABANE',
    currentUser: null,
    mainControllerOnline: false,
    lastMainHeartbeat: 0,

    virtualSwitches: new Array(24).fill(0),
    physicalSwitches: new Array(24).fill(0),

    stationFeedback: new Array(6).fill(0), // Bits 0-7 per station
    stationOnline: new Array(6).fill(false),
    stationLastSeen: new Array(6).fill(0),

    // Global Alarm State (Calculated by Pi)
    globalVacuumAlarm: false
};

let lastControlTakeTime = 0;
let lastReleaseTime = 0;
let ioRef = null;

// --- CONFIGURATION ---

const INPUT_MAP = [
    { idx: 0, st: 1, bit: 0 }, { idx: 1, st: 1, bit: 1 },
    { idx: 2, st: 0, bit: 0 }, { idx: 3, st: 0, bit: 1 },
    { idx: 4, st: 1, bit: 2 }, { idx: 5, st: 1, bit: 3 },
    { idx: 6, st: 1, bit: 4 }, { idx: 7, st: 1, bit: 5 },
    { idx: 8, st: 2, bit: 0 }, { idx: 9, st: 2, bit: 1 },
    { idx: 10, st: 2, bit: 2 }, { idx: 11, st: 2, bit: 3 },
    { idx: 12, st: 3, bit: 0 }, { idx: 13, st: 3, bit: 1 },
    { idx: 14, st: 3, bit: 2 }, { idx: 15, st: 3, bit: 3 },
    { idx: 16, st: 4, bit: 0 }, { idx: 17, st: 4, bit: 1 },
    { idx: 18, st: 4, bit: 2 },
    { idx: 19, st: 5, bit: 0 }, { idx: 20, st: 5, bit: 1 }
];

// Thermostat Config
// ST0 TH (Sw 22) -> Overrides Switches 2, 9, 14. Feedback: ST0 Bit 3
// ST4 TH (Sw 23) -> Overrides Switch 17. Feedback: ST4 Bit 3
const THERMOSTATS = [
    { swIdx: 22, feedbackSt: 0, feedbackBit: 3, overrides: [2, 9, 14] },
    { swIdx: 23, feedbackSt: 4, feedbackBit: 3, overrides: [17] }
];

// Vacuum Switches (For Alarm Calculation)
// Maps Switch Index to specific Feedback Bit to check
const VACUUM_CHECKS = [
    { swIdx: 2, st: 1, bit: 2 }, // Vac 1
    { swIdx: 3, st: 1, bit: 2 }, // Vac 2
    { swIdx: 9, st: 2, bit: 1 }, // St2 Vac
    { swIdx: 14, st: 3, bit: 2 }, // St3 Vac
    { swIdx: 17, st: 4, bit: 1 }  // St4 Vac
];

function init(io) {
    ioRef = io;
    setInterval(checkHeartbeats, 1000);
    setInterval(controlLoop, 100);
}

function getFullState() { return state; }

// --- HANDLERS ---

function updatePhysicalState(switchBytes, isOverrideActive) {
    state.mainControllerOnline = true;
    state.lastMainHeartbeat = Date.now();

    for (let i = 0; i < 24; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = i % 8;
        state.physicalSwitches[i] = (switchBytes[byteIdx] >> bitIdx) & 1;
    }

    if (state.controller === 'CABANE') {
        state.virtualSwitches = [...state.physicalSwitches];
        if (isOverrideActive && (Date.now() - lastReleaseTime > 3000)) {
            console.log("[SYNC] Main in Override. Pi assuming SERVER.");
            state.controller = 'SERVER';
        }
    } else {
        if (!isOverrideActive && (Date.now() - lastControlTakeTime > 3000)) {
            console.log("[SYNC] Emergency Release.");
            releaseToCabane();
        }
    }
    pushUpdate();
}

function updateStationFeedback(id, bits) {
    if (id >= 0 && id < 6) {
        state.stationFeedback[id] = bits;
        state.stationOnline[id] = true;
        state.stationLastSeen[id] = Date.now();
        pushUpdate(); // Real-time feedback update
    }
}

// --- ACTIONS ---

function takeControl(username) {
    state.controller = 'USER';
    state.currentUser = username;
    lastControlTakeTime = Date.now();
    udpService.sendOverrideCommand(1);
    console.log(`[CONTROL] Taken by ${username}`);
    pushUpdate();
}

function releaseToServer() {
    state.controller = 'SERVER';
    state.currentUser = null;
    lastControlTakeTime = Date.now();
    udpService.sendOverrideCommand(1);
    console.log(`[CONTROL] Released to SERVER`);
    pushUpdate();
}

function releaseToCabane() {
    state.controller = 'CABANE';
    state.currentUser = null;
    lastReleaseTime = Date.now();
    udpService.sendOverrideCommand(0);
    console.log(`[CONTROL] Released to CABANE`);
    pushUpdate();
}

function toggleSwitch(idx, value) {
    if (idx < 0 || idx > 23) return;
    if (state.controller === 'CABANE') return;
    state.virtualSwitches[idx] = value ? 1 : 0;
    pushUpdate();
}

// --- CORE CONTROL LOOP (The Independent Logic) ---

function controlLoop() {

    // 1. CALCULATE ACTIVE COMMANDS (Applying Thermostats)
    // We create a temporary command array based on Virtual Switches + Logic
    const activeCommands = [...state.virtualSwitches];

    THERMOSTATS.forEach(th => {
        // If Thermostat Switch is ON
        if (state.virtualSwitches[th.swIdx]) {
            // Check Temp Sensor (Active Low: 0 = Cold/Active, 1 = Warm/Idle)
            const rawBit = (state.stationFeedback[th.feedbackSt] >> th.feedbackBit) & 1;
            const isCold = (rawBit === 0);

            if (isCold) {
                // Override the target pumps to ON
                th.overrides.forEach(targetIdx => {
                    activeCommands[targetIdx] = 1;
                });
            }
        }
    });

    // 2. CHECK VACUUM ALARMS
    let alarmDetected = false;
    VACUUM_CHECKS.forEach(chk => {
        const commandedOn = activeCommands[chk.swIdx];
        // Feedback: 0 = Vacuum Good (Running), 1 = No Vacuum (Off/Fail)
        const rawFb = (state.stationFeedback[chk.st] >> chk.bit) & 1;
        const noVacuum = (rawFb === 1);

        if (commandedOn && noVacuum) {
            // Logic: Wait... pumps take time to build vacuum. 
            // Ideally we need a delay here, but for now simple logic:
            alarmDetected = true;
        }
    });
    state.globalVacuumAlarm = alarmDetected;

    // 3. BROADCAST COMMANDS (Only if Pi is Master)
    if (state.controller === 'USER' || state.controller === 'SERVER') {
        const stationBytes = new Array(6).fill(0);
        INPUT_MAP.forEach(m => {
            if (activeCommands[m.idx]) { // Use the computed commands (with TH overrides)
                stationBytes[m.st] |= (1 << m.bit);
            }
        });
        udpService.sendGlobalBroadcast(stationBytes);

        // NOTE: We REMOVED sending 0xB0 (Remote Data) to Main Controller 
        // as per your request. Main Controller will rely on Station Feedback.
    }
}

function checkHeartbeats() {
    const now = Date.now();
    if (state.mainControllerOnline && (now - state.lastMainHeartbeat > 5000)) {
        console.log("[ALARM] Main Controller LOST! Switching to SERVER.");
        state.mainControllerOnline = false;
        if (state.controller === 'CABANE') takeControl('SYSTEM_FAILSAFE');
        pushUpdate();
    }
    for (let i = 0; i < 6; i++) {
        if (state.stationOnline[i] && (now - state.stationLastSeen[i] > 3000)) {
            state.stationOnline[i] = false;
            state.stationFeedback[i] = 0;
            pushUpdate();
        }
    }
}

function pushUpdate() {
    if (ioRef) ioRef.emit('STATE_UPDATE', state);
}

module.exports = {
    init, getFullState, updatePhysicalState, updateStationFeedback,
    takeControl, releaseToServer, releaseToCabane, toggleSwitch
};