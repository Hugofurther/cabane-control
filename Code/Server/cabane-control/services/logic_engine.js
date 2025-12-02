// ============================================================
// 🧠 LOGIC ENGINE (State Machine) - v9 STUBBORN MODE
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
    globalVacuumAlarm: false,
    buzzerEnabled: false,
    buzzerStatus: 'OFF'
};

// --- TIMING ---
let lastControlTakeTime = 0;
let lastReleaseTime = 0;
let lastChirpTime = 0;
let alarmCycleStart = 0;
let overrideAssertCounter = 0;
let ioRef = null;

// --- CONFIGURATION ---
// (Input Map, Thermostats, Vacuum Checks remain the same)
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
    { swIdx: 2, st: 1, bit: 2 }, { swIdx: 3, st: 1, bit: 2 },
    { swIdx: 9, st: 2, bit: 1 }, { swIdx: 14, st: 3, bit: 2 },
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

    // Update Physical Switches
    for (let i = 0; i < 24; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = i % 8;
        state.physicalSwitches[i] = (switchBytes[byteIdx] >> bitIdx) & 1;
    }

    // --- SYNC LOGIC ---

    // Case 1: Pi thinks CABANE is driving
    if (state.controller === 'CABANE') {
        state.virtualSwitches = [...state.physicalSwitches];

        // If Main reports it IS overridden, Pi must catch up
        // (Wait 3s after a release command before believing this, to avoid bounce)
        if (isOverrideActive && (Date.now() - lastReleaseTime > 3000)) {
            console.log("[SYNC] Main detected in Override Mode. Pi syncing to SERVER Mode.");
            state.controller = 'SERVER';
            state.currentUser = null;
            lastControlTakeTime = Date.now();
        }
    }
    // Case 2: Pi thinks PI (User/Server) is driving
    else {
        // --- If Pi is driving (USER/SERVER) ---

        if (!isOverrideActive) {
            // Main says: "I am NOT overridden"

            const timeSinceTake = Date.now() - lastControlTakeTime;

            // Check Grace Period (5 seconds)
            if (timeSinceTake < 5000) {
                // We are in the grace period. RETRY.
                // Console log to prove we are trying
                // console.log(`[SYNC] Retrying Override... (${timeSinceTake}ms elapsed)`);
                udpService.sendOverrideCommand(1);
            }
            else {
                // Timeout expired.
                console.log(`[SYNC] REVERTING TO CABANE. Time since take: ${timeSinceTake}ms. isOverrideActive: ${isOverrideActive}`);

                state.controller = 'CABANE';
                state.currentUser = null;
            }
        }
    }
    pushUpdate();
}

function updateStationFeedback(id, bits) {
    if (id >= 0 && id < 6) {
        state.stationFeedback[id] = bits;
        state.stationOnline[id] = true;
        state.stationLastSeen[id] = Date.now();
        if (id === 1) { // Debug bridge
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

    udpService.sendOverrideCommand(1); // Immediate Send
    console.log(`[CONTROL] Taken by ${username}`);
    pushUpdate();
}

function releaseToServer() {
    state.controller = 'SERVER';
    state.currentUser = null;
    lastControlTakeTime = Date.now();

    udpService.sendOverrideCommand(1); // Ensure Main knows we are still boss
    console.log(`[CONTROL] Released to SERVER`);
    pushUpdate();
}

function releaseToCabane() {
    state.controller = 'CABANE';
    state.currentUser = null;
    lastReleaseTime = Date.now();

    udpService.sendOverrideCommand(0); // Send explicit release
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
        const rawFb = (state.stationFeedback[chk.st] >> chk.bit) & 1;
        if (commandedOn && rawFb === 1) {
            alarmDetected = true;
        }
    });

    if (state.globalVacuumAlarm !== alarmDetected) {
        state.globalVacuumAlarm = alarmDetected;
        stateChanged = true;
        alarmCycleStart = now;
    }

    // 4. BUZZER STATUS
    let newBuzzerStatus = 'OFF';
    if (state.globalVacuumAlarm) {
        if (state.buzzerEnabled) {
            const cycleTime = (now - alarmCycleStart) % 15000;
            newBuzzerStatus = (cycleTime < 5000) ? 'SIREN' : 'OFF';
        }
    } else if (!state.buzzerEnabled) {
        const anyVacuumRunning = VACUUM_CHECKS.some(chk => state.virtualSwitches[chk.swIdx]);
        if (anyVacuumRunning && (now - lastChirpTime > 60000)) {
            newBuzzerStatus = 'CHIRP';
            if (now - lastChirpTime > 61000) lastChirpTime = now;
        }
    }

    if (state.buzzerStatus !== newBuzzerStatus) {
        state.buzzerStatus = newBuzzerStatus;
        stateChanged = true;
    }

    if (stateChanged) pushUpdate();

    // 5. NETWORK OUTPUTS (If Pi is Master)
    if (state.controller === 'USER' || state.controller === 'SERVER') {
        const stationBytes = new Array(6).fill(0);
        INPUT_MAP.forEach(m => {
            if (state.virtualSwitches[m.idx]) {
                stationBytes[m.st] |= (1 << m.bit);
            }
        });
        udpService.sendGlobalBroadcast(stationBytes);

        const virtualBytes = [0, 0, 0];
        for (let i = 0; i < 24; i++) if (state.virtualSwitches[i]) virtualBytes[Math.floor(i / 8)] |= (1 << (i % 8));
        udpService.sendRemoteData(virtualBytes);

        // AGGRESSIVE ASSERTION
        // Send 0xAF (Take Control) every 500ms to ensure Main knows we are driving
        overrideAssertCounter++;
        if (overrideAssertCounter >= 5) {
            udpService.sendOverrideCommand(1);
            overrideAssertCounter = 0;
        }
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