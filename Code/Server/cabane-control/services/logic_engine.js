// ============================================================
// 🧠 LOGIC ENGINE - v19 STABILITY FIX (Crash Resolved)
// ============================================================
const udpService = require('./udp_service');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./cabane.db');

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
    buzzerStatus: 'OFF',
    timezone: 'UTC'
};

// --- TIMING & FLAGS ---
let controlHandshakeConfirmed = false;
let lastControlTakeTime = 0;
let lastReleaseTime = 0;
let lastChirpTime = 0;
let alarmCycleStart = 0;
let prevSirenCondition = false;
let prevChirpCondition = false;

// ✅ DEFINED VARIABLES (Fixing the crash)
let overrideAssertCounter = 0;
let isForcingRelease = false;
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

const THERMOSTATS = [
    { name: "TH1", swIdx: 22, feedbackSt: 0, feedbackBit: 3, overrides: [2, 9, 14] },
    { name: "TH2", swIdx: 23, feedbackSt: 4, feedbackBit: 3, overrides: [17] }
];

const VACUUM_CHECKS = [
    { swIdx: 2, st: 1, bit: 2 }, { swIdx: 3, st: 1, bit: 2 },
    { swIdx: 9, st: 2, bit: 1 }, { swIdx: 14, st: 3, bit: 2 },
    { swIdx: 17, st: 4, bit: 1 }
];

// --- LOGGING ---
function logSystemEvent(type, message) {
    const timestamp = new Date().toISOString();
    db.run("INSERT INTO logs (user_id, type, message, timestamp) VALUES (?, ?, ?, ?)",
        [null, type, message, timestamp],
        (err) => { if (err) console.error("DB Log Error:", err); }
    );
    if (ioRef) {
        ioRef.emit('NEW_LOG', { id: Date.now(), timestamp, user_id: null, username: 'SYSTEM', type, message });
    }
}

function init(io) {
    ioRef = io;
    db.get("SELECT value FROM system_settings WHERE key = 'timezone'", (err, row) => {
        if (row && row.value) state.timezone = row.value;
    });
    setInterval(checkHeartbeats, 1000);
    setInterval(controlLoop, 100);
}

function getFullState() { return state; }
function updateTimezone(newTz) { state.timezone = newTz; pushUpdate(); }

// --- HANDLERS ---

function updatePhysicalState(switchBytes, isOverrideActive) {

    // 1. RECONNECTION DETECTION (Absolute Priority)
    // If the Main Controller was offline and just came back, we force a release.
    if (!state.mainControllerOnline) {
        console.log("[NET] Main Controller Detected Online.");
        logSystemEvent('SYSTEM', "Main Controller Reconnected.");
        state.mainControllerOnline = true;

        // If Pi was driving, trigger the Force Release Sequence
        if (state.controller !== 'CABANE') {
            console.log("[SYNC] Main Reconnected. Starting Force Release.");

            state.controller = 'CABANE';
            state.currentUser = null;
            lastReleaseTime = Date.now();
            controlHandshakeConfirmed = false;

            isForcingRelease = true; // Start the hammer
            udpService.sendOverrideCommand(0);
            pushUpdate();
            return;
        }
    }

    state.lastMainHeartbeat = Date.now();

    for (let i = 0; i < 24; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = i % 8;
        state.physicalSwitches[i] = (switchBytes[byteIdx] >> bitIdx) & 1;
    }

    // 2. FORCE RELEASE LOGIC
    if (isForcingRelease) {
        if (isOverrideActive) {
            // Main hasn't heard us yet. Resend.
            // console.log("[SYNC] ... Retrying Release Command");
            udpService.sendOverrideCommand(0);
        } else {
            // Success. Main is back in charge.
            console.log("[SYNC] Main Controller Release Confirmed.");
            isForcingRelease = false;
        }
        return; // Stop processing standard sync
    }

    // 3. STANDARD SYNC LOGIC
    if (state.controller === 'CABANE') {
        state.virtualSwitches = [...state.physicalSwitches];

        // Headless Recovery: If Main reports Override and we aren't forcing release -> Sync to Server
        if (isOverrideActive && (Date.now() - lastReleaseTime > 3000)) {
            console.log("[SYNC] Main in Override. Pi assuming SERVER.");
            state.controller = 'SERVER';
            state.currentUser = null;
            controlHandshakeConfirmed = true;
        }
    }
    else {
        // Pi Driving
        if (isOverrideActive) {
            controlHandshakeConfirmed = true;
        }
        else {
            // Main says "Not Overridden"
            if (!controlHandshakeConfirmed) {
                // Handshake Retry
                udpService.sendOverrideCommand(1);
            }
            else {
                // Main asserted Manual Control (Emergency Buttons)
                console.log("[SYNC] Main Controller forced Manual Mode.");
                state.controller = 'CABANE';
                state.currentUser = null;
                controlHandshakeConfirmed = false;
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
        if (id === 1) { state.stationOnline[0] = true; state.stationLastSeen[0] = Date.now(); }
        pushUpdate();
    }
}

// --- ACTIONS ---

function takeControl(username) {
    state.controller = 'USER';
    state.currentUser = username;
    lastControlTakeTime = Date.now();
    controlHandshakeConfirmed = false;
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
    // SAFETY CHECK: Is Main Controller actually there?
    if (!state.mainControllerOnline) {
        console.log("[CONTROL] Cannot release to Cabane (Offline). Switching to SERVER mode.");
        logSystemEvent('CONTROL', "Release to Cabane blocked (Offline). Holding in Server Mode.");

        // Redirect to Server Mode logic
        releaseToServer();
        return;
    }

    state.controller = 'CABANE';
    state.currentUser = null;
    lastReleaseTime = Date.now();
    controlHandshakeConfirmed = false;

    udpService.sendOverrideCommand(0);
    console.log(`[CONTROL] Released to CABANE`);
    pushUpdate();
}

function toggleSwitch(idx, value) {
    if (idx < 0 || idx > 23) return;
    if (state.controller === 'CABANE') return;
    state.virtualSwitches[idx] = value ? 1 : 0; pushUpdate();
}

// --- CORE CONTROL LOOP ---

function controlLoop() {
    const now = Date.now();
    let stateChanged = false;

    state.buzzerEnabled = !!state.virtualSwitches[21];

    // 1. THERMOSTATS
    THERMOSTATS.forEach(th => {
        if (state.virtualSwitches[th.swIdx]) {
            const rawBit = (state.stationFeedback[th.feedbackSt] >> th.feedbackBit) & 1;
            if (rawBit === 0) {
                th.overrides.forEach(targetIdx => {
                    if (state.virtualSwitches[targetIdx] === 0) {
                        logSystemEvent('AUTO', `Thermostat ${th.name} forcing Switch ${targetIdx} ON`);
                        state.virtualSwitches[targetIdx] = 1; stateChanged = true;
                    }
                });
            }
        }
    });

    // 2. ALARMS
    let alarmDetected = false;
    VACUUM_CHECKS.forEach(chk => {
        const commandedOn = state.virtualSwitches[chk.swIdx];
        const rawFb = (state.stationFeedback[chk.st] >> chk.bit) & 1;
        if (commandedOn && rawFb === 1) alarmDetected = true;
    });

    if (state.globalVacuumAlarm !== alarmDetected) {
        state.globalVacuumAlarm = alarmDetected;
        if (alarmDetected) logSystemEvent('ALARM', "Vacuum Loss Detected");
        else logSystemEvent('INFO', "Vacuum Alarm Cleared");
        stateChanged = true;
        alarmCycleStart = now;
    }

    // 3. BUZZER
    const isSirenCondition = state.globalVacuumAlarm && state.buzzerEnabled;
    const anyVacuumRunning = VACUUM_CHECKS.some(chk => state.virtualSwitches[chk.swIdx]);
    const isChirpCondition = !state.globalVacuumAlarm && !state.buzzerEnabled && anyVacuumRunning;

    if (isSirenCondition && !prevSirenCondition) alarmCycleStart = now;
    if (isChirpCondition && !prevChirpCondition) lastChirpTime = now - 300000;

    prevSirenCondition = isSirenCondition;
    prevChirpCondition = isChirpCondition;

    let newBuzzerStatus = 'OFF';
    if (isSirenCondition) {
        const cycleTime = (now - alarmCycleStart) % 15000;
        newBuzzerStatus = (cycleTime < 5000) ? 'SIREN' : 'OFF';
    }
    else if (isChirpCondition) {
        if (now - lastChirpTime >= 300000) {
            newBuzzerStatus = 'CHIRP';
            if (now - lastChirpTime > 301000) lastChirpTime = now;
        }
    }

    if (state.buzzerStatus !== newBuzzerStatus) {
        state.buzzerStatus = newBuzzerStatus;
        stateChanged = true;
    }

    if (stateChanged) pushUpdate();

    // 4. NETWORK OUTPUTS
    if (state.controller === 'USER' || state.controller === 'SERVER') {
        const stationBytes = new Array(6).fill(0);
        INPUT_MAP.forEach(m => {
            if (state.virtualSwitches[m.idx]) stationBytes[m.st] |= (1 << m.bit);
        });
        udpService.sendGlobalBroadcast(stationBytes);

        const virtualBytes = [0, 0, 0];
        for (let i = 0; i < 24; i++) if (state.virtualSwitches[i]) virtualBytes[Math.floor(i / 8)] |= (1 << (i % 8));
        udpService.sendRemoteData(virtualBytes);

        if (!controlHandshakeConfirmed) {
            overrideAssertCounter++;
            if (overrideAssertCounter >= 5) {
                udpService.sendOverrideCommand(1);
                overrideAssertCounter = 0;
            }
        }
    }
}

function checkHeartbeats() {
    const now = Date.now();
    if (state.mainControllerOnline && (now - state.lastMainHeartbeat > 5000)) {
        logSystemEvent('ALARM', "Main Controller LOST! Switching to Headless.");
        state.mainControllerOnline = false;
        // Headless take-over logic
        if (state.controller === 'CABANE') takeControl('SYSTEM_FAILSAFE');
        pushUpdate();
    }
    for (let i = 0; i < 6; i++) {
        if (state.stationOnline[i] && (now - state.stationLastSeen[i] > 3000)) {
            state.stationOnline[i] = false;
            pushUpdate();
        }
    }
}

function pushUpdate() { if (ioRef) ioRef.emit('STATE_UPDATE', state); }

module.exports = {
    init, getFullState, updatePhysicalState, updateStationFeedback,
    takeControl, releaseToServer, releaseToCabane, toggleSwitch, updateTimezone
};