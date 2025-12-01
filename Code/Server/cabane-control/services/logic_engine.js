// ============================================================
// 🧠 LOGIC ENGINE (State Machine) - v7.1 FIX
// ============================================================
const udpService = require('./udp_service');

const state = {
    controller: 'CABANE',
    currentUser: null,
    mainControllerOnline: false,
    lastMainHeartbeat: 0,

    virtualSwitches: new Array(24).fill(0),
    physicalSwitches: new Array(24).fill(0),

    stationFeedback: new Array(6).fill(0),
    stationOnline: new Array(6).fill(false),
    stationLastSeen: new Array(6).fill(0),

    // Global Alarm State
    globalVacuumAlarm: false,
    buzzerEnabled: false,
    buzzerStatus: 'OFF'
};

// --- TIMING VARIABLES ---
let lastControlTakeTime = 0;
let lastReleaseTime = 0;
let ioRef = null;

// ✅ ADDED THESE MISSING VARIABLES
let lastChirpTime = 0;
let alarmCycleStart = 0;

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

const THERMOSTATS = [
    { name: "TH1", swIdx: 22, feedbackSt: 0, feedbackBit: 3, overrides: [2, 9, 14] },
    { name: "TH2", swIdx: 23, feedbackSt: 4, feedbackBit: 3, overrides: [17] }
];

const VACUUM_CHECKS = [
    { swIdx: 2, st: 1, bit: 2 },
    { swIdx: 3, st: 1, bit: 2 },
    { swIdx: 9, st: 2, bit: 1 },
    { swIdx: 14, st: 3, bit: 2 },
    { swIdx: 17, st: 4, bit: 1 }
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

        // DEBUG HACK (Bridge ST0 via ST1)
        if (id === 1) {
            state.stationOnline[0] = true;
            state.stationLastSeen[0] = Date.now();
        }

        pushUpdate();
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

// --- CORE CONTROL LOOP ---

function controlLoop() {
    const now = Date.now();
    let stateChanged = false;

    // 1. UPDATE BUZZER SWITCH STATE
    state.buzzerEnabled = !!state.virtualSwitches[21];

    // 2. APPLY THERMOSTAT LOGIC
    THERMOSTATS.forEach(th => {
        if (state.virtualSwitches[th.swIdx]) {
            const stationBits = state.stationFeedback[th.feedbackSt];
            const rawBit = (stationBits >> th.feedbackBit) & 1;
            const isCold = (rawBit === 0);

            if (isCold) {
                th.overrides.forEach(targetIdx => {
                    if (state.virtualSwitches[targetIdx] === 0) {
                        // console.log(`[AUTO] Thermostat forcing Switch ${targetIdx} ON`);
                        state.virtualSwitches[targetIdx] = 1;
                        stateChanged = true;
                    }
                });
            }
        }
    });

    // 3. CHECK VACUUM ALARMS
    let alarmDetected = false;
    VACUUM_CHECKS.forEach(chk => {
        const commandedOn = state.virtualSwitches[chk.swIdx];
        const rawFb = (state.stationFeedback[chk.st] >> chk.bit) & 1; // 1 = No Vacuum
        if (commandedOn && rawFb === 1) {
            alarmDetected = true;
        }
    });

    if (state.globalVacuumAlarm !== alarmDetected) {
        state.globalVacuumAlarm = alarmDetected;
        stateChanged = true;
        alarmCycleStart = now;
    }

    // 4. CALCULATE BUZZER STATUS
    let newBuzzerStatus = 'OFF';

    if (state.globalVacuumAlarm) {
        if (state.buzzerEnabled) {
            const cycleTime = (now - alarmCycleStart) % 15000;
            if (cycleTime < 5000) newBuzzerStatus = 'SIREN';
            else newBuzzerStatus = 'OFF';
        } else {
            newBuzzerStatus = 'OFF';
        }
    }
    else {
        if (!state.buzzerEnabled) {
            const anyVacuumRunning = VACUUM_CHECKS.some(chk => state.virtualSwitches[chk.swIdx]);
            if (anyVacuumRunning) {
                if (now - lastChirpTime > 60000) {
                    newBuzzerStatus = 'CHIRP';
                    if (now - lastChirpTime > 61000) lastChirpTime = now;
                }
            }
        }
    }

    if (state.buzzerStatus !== newBuzzerStatus) {
        state.buzzerStatus = newBuzzerStatus;
        stateChanged = true;
    }

    if (stateChanged) pushUpdate();

    // 5. BROADCAST COMMANDS
    if (state.controller === 'USER' || state.controller === 'SERVER') {
        const stationBytes = new Array(6).fill(0);
        INPUT_MAP.forEach(m => {
            if (state.virtualSwitches[m.idx]) {
                stationBytes[m.st] |= (1 << m.bit);
            }
        });
        udpService.sendGlobalBroadcast(stationBytes);

        // Send 0xB0 to Main Controller for LED Sync
        const virtualBytes = [0, 0, 0];
        for (let i = 0; i < 24; i++) if (state.virtualSwitches[i]) virtualBytes[Math.floor(i / 8)] |= (1 << (i % 8));
        udpService.sendRemoteData(virtualBytes);
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
            // state.stationFeedback[i] = 0;
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