// ============================================================
// 🧠 LOGIC ENGINE - PRODUCTION v22 (Pure Physical Truth)
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
    burglarAlarm: false,
    buzzerEnabled: false,
    buzzerStatus: 'OFF',
    timezone: 'UTC',
    disabledStations: []
    // ❌ REMOVED: simulationMode (Logic Engine doesn't care anymore)
};

function getFullState() { return state; }

let cachedConfig = { onSec: 5, offSec: 10, remMin: 2, burgSt: 0 };
let lastPushedStateStr = "";
let controlHandshakeConfirmed = false;
let lastControlTakeTime = 0;
let lastReleaseTime = 0;
let lastChirpTime = 0;
let alarmCycleStart = 0;
let prevSirenCondition = false;
let prevChirpCondition = false;
let overrideAssertCounter = 0;
let isForcingRelease = false;
let ioRef = null;

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

function logSystemEvent(type, message) {
    const timestamp = new Date().toISOString();
    db.run("INSERT INTO logs (user_id, type, message, timestamp) VALUES (?, ?, ?, ?)",
        [null, type, message, timestamp], (err) => { if (err) console.error("DB Log Error:", err); });
    if (ioRef) ioRef.emit('NEW_LOG', { id: Date.now(), timestamp, user_id: null, username: 'SYSTEM', type, message });
}

function getStationMask() {
    let mask = 0;
    for (let i = 0; i < 6; i++) {
        if (!state.disabledStations.includes(i)) mask |= (1 << i);
    }
    return mask;
}

function init(io) {
    ioRef = io;
    db.all("SELECT key, value FROM system_settings", (err, rows) => {
        if (rows) {
            rows.forEach(row => {
                if (row.key === 'timezone') state.timezone = row.value;
                if (row.key === 'disabled_stations') {
                    try { state.disabledStations = JSON.parse(row.value); } catch (e) { }
                }
                if (row.key === 'buzzer_alarm_on') cachedConfig.onSec = parseInt(row.value) || 5;
                if (row.key === 'buzzer_alarm_off') cachedConfig.offSec = parseInt(row.value) || 10;
                if (row.key === 'buzzer_reminder_min') cachedConfig.remMin = parseInt(row.value) || 2;
                if (row.key === 'burglar_station') cachedConfig.burgSt = parseInt(row.value) || 0;
            });
        }
    });

    // Initialize Automation (but NOT Simulation, to keep dependencies clean)
    const automationService = require('./automation_service');
    automationService.init(module.exports, io);

    setInterval(checkHeartbeats, 1000);
    setInterval(controlLoop, 100);
}

function updateTimezone(newTz) { state.timezone = newTz; pushUpdate(); }

function updateDisabled(jsonStr) {
    try {
        state.disabledStations = JSON.parse(jsonStr);
        pushConfigToArduino();
        pushUpdate();
    } catch (e) { }
}

function updateConfig(onSec, offSec, remMin, burgSt) {
    if (onSec > 0 && offSec > 0 && remMin > 0) {
        cachedConfig = { onSec, offSec, remMin, burgSt };
        pushConfigToArduino();
        pushUpdate();
    }
}

function pushConfigToArduino() {
    const mask = getStationMask();
    udpService.sendConfigPacket(cachedConfig.onSec, cachedConfig.offSec, cachedConfig.remMin, cachedConfig.burgSt, mask);
}

function applyThermostatOverrides() {
    let changed = false;
    THERMOSTATS.forEach(th => {
        if (state.virtualSwitches[th.swIdx]) {
            const rawBit = (state.stationFeedback[th.feedbackSt] >> th.feedbackBit) & 1;
            if (rawBit === 0) {
                th.overrides.forEach(targetIdx => {
                    if (state.virtualSwitches[targetIdx] === 0) {
                        state.virtualSwitches[targetIdx] = 1;
                        changed = true;
                    }
                });
            }
        }
    });
    return changed;
}

function updatePhysicalState(switchBytes, isOverrideActive) {
    // ✅ ALWAYS PROCESS REALITY.
    // If a Sim is running, the Frontend will hide this state for the Sim Owner,
    // but the Backend must know the truth.
    state.lastMainHeartbeat = Date.now();

    if (!state.mainControllerOnline) {
        state.mainControllerOnline = true;
        console.log("[SYNC] 🟢 Main Controller RECONNECTED.");
        logSystemEvent('SYSTEM', "Main Controller Online.");
        pushConfigToArduino();
        state.controller = 'CABANE';
        state.currentUser = null;
        lastReleaseTime = Date.now();
        controlHandshakeConfirmed = false;
        isForcingRelease = true;
        udpService.sendOverrideCommand(0);
        pushUpdate();
        return;
    }

    for (let i = 0; i < 24; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = i % 8;
        state.physicalSwitches[i] = (switchBytes[byteIdx] >> bitIdx) & 1;
    }

    if (isForcingRelease) {
        if (isOverrideActive) udpService.sendOverrideCommand(0);
        else isForcingRelease = false;
        return;
    }

    if (state.controller === 'CABANE') {
        state.virtualSwitches = [...state.physicalSwitches];
        applyThermostatOverrides();

        if (isOverrideActive && (Date.now() - lastReleaseTime > 3000)) {
            state.controller = 'SERVER';
            state.currentUser = null;
            controlHandshakeConfirmed = true;
        }
    } else {
        if (isOverrideActive) {
            controlHandshakeConfirmed = true;
        } else {
            if (!controlHandshakeConfirmed) udpService.sendOverrideCommand(1);
            else {
                console.log("[SYNC] Main Controller reclaimed control manually.");
                logSystemEvent('CONTROL', "Physical Override Triggered on Panel.");
                state.controller = 'CABANE';
                state.currentUser = null;
                controlHandshakeConfirmed = false;
            }
        }
    }
    pushUpdate();
}

function updateStationHeartbeat(id) {
    // ✅ ALWAYS PROCESS HEARTBEAT.
    if (id >= 0 && id < 6) {
        state.stationOnline[id] = true;
        state.stationLastSeen[id] = Date.now();
        if (id === 1) { state.stationOnline[0] = true; state.stationLastSeen[0] = Date.now(); }
        pushUpdate();
    }
}

function updateStationFeedback(id, bits) {
    // ✅ ALWAYS PROCESS FEEDBACK.
    if (id >= 0 && id < 6) {
        state.stationFeedback[id] = bits;
        state.stationOnline[id] = true;
        state.stationLastSeen[id] = Date.now();
        if (id === 1) { state.stationOnline[0] = true; state.stationLastSeen[0] = Date.now(); }
        pushUpdate();
    }
}

// ❌ REMOVED: updateSimFeedback (Sim Service should not touch Logic Engine State)

function takeControl(username) {
    state.controller = 'USER';
    state.currentUser = username;
    lastControlTakeTime = Date.now();
    controlHandshakeConfirmed = false;
    udpService.sendOverrideCommand(1);
    pushUpdate();
}

function releaseToServer() {
    if (!state.mainControllerOnline) {
        takeControl('SYSTEM_FAILSAFE');
        return;
    }
    state.controller = 'SERVER';
    state.currentUser = null;
    lastControlTakeTime = Date.now();
    udpService.sendOverrideCommand(1);
    pushUpdate();
}

function releaseToCabane() {
    if (!state.mainControllerOnline) {
        takeControl('SYSTEM_FAILSAFE');
        return;
    }
    state.controller = 'CABANE';
    state.currentUser = null;
    lastReleaseTime = Date.now();
    controlHandshakeConfirmed = false;
    isForcingRelease = true;
    udpService.sendOverrideCommand(0);
    pushUpdate();
}

function toggleSwitch(idx, value, actor) {
    if (idx < 0 || idx > 23) return;

    // ✅ PURE PHYSICAL LOGIC.
    // Simulator toggles are handled by simulation_service.js/toggleSimSwitch
    if (state.controller === 'CABANE') return;
    const isController = state.controller === 'SERVER' || (state.controller === 'USER' && state.currentUser === actor);
    const isAuto = actor === 'AUTO';

    if (isController || isAuto) {
        state.virtualSwitches[idx] = value ? 1 : 0;
        pushUpdate();
    }
}

function controlLoop() {
    const now = Date.now();
    let stateChanged = false;
    state.buzzerEnabled = !!state.virtualSwitches[21];

    if (applyThermostatOverrides()) stateChanged = true;

    // Vacuum Alarms
    let alarmDetected = false;
    VACUUM_CHECKS.forEach(chk => {
        if (!state.stationOnline[chk.st] || state.disabledStations.includes(chk.st)) return;
        const commandedOn = state.virtualSwitches[chk.swIdx];
        const rawFb = (state.stationFeedback[chk.st] >> chk.bit) & 1;
        if (commandedOn && rawFb === 1) alarmDetected = true;
    });

    if (state.globalVacuumAlarm !== alarmDetected) {
        state.globalVacuumAlarm = alarmDetected;
        if (alarmDetected) logSystemEvent('ALARM', "Vacuum Loss Detected");
        stateChanged = true; alarmCycleStart = now;
    }

    // Burglar Alarm
    let burgDetected = false;
    if (cachedConfig.burgSt === 2 && state.stationOnline[2]) {
        if ((state.stationFeedback[2] >> 4) & 1) burgDetected = true;
    } else if (cachedConfig.burgSt === 3 && state.stationOnline[3]) {
        if ((state.stationFeedback[3] >> 4) & 1) burgDetected = true;
    }

    if (state.burglarAlarm !== burgDetected) {
        state.burglarAlarm = burgDetected;
        if (burgDetected) logSystemEvent('ALARM', "Burglar Alarm Triggered!");
        stateChanged = true;
    }

    // Audio Logic
    const isSirenCondition = (state.globalVacuumAlarm || state.burglarAlarm) && state.buzzerEnabled;
    const anyVacuumRunning = VACUUM_CHECKS.some(chk => state.virtualSwitches[chk.swIdx]);
    const isChirpCondition = !state.globalVacuumAlarm && !state.burglarAlarm && !state.buzzerEnabled && anyVacuumRunning;

    if (isSirenCondition && !prevSirenCondition) alarmCycleStart = now;
    if (isChirpCondition && !prevChirpCondition) lastChirpTime = now - 300000;
    prevSirenCondition = isSirenCondition; prevChirpCondition = isChirpCondition;

    let newBuzzerStatus = 'OFF';
    if (isSirenCondition) {
        const cycleTime = (now - alarmCycleStart) % 15000;
        newBuzzerStatus = (cycleTime < 5000) ? 'SIREN' : 'OFF';
    } else if (isChirpCondition) {
        if (now - lastChirpTime >= 300000) { newBuzzerStatus = 'CHIRP'; if (now - lastChirpTime > 301000) lastChirpTime = now; }
    }
    if (state.buzzerStatus !== newBuzzerStatus) { state.buzzerStatus = newBuzzerStatus; stateChanged = true; }

    if (stateChanged) pushUpdate();

    // UDP Output (REAL ONLY)
    // We ALWAYS send UDP if we are the controller. The Sim logic is completely separate.
    if (state.controller === 'USER' || state.controller === 'SERVER') {
        const stationBytes = new Array(6).fill(0);
        INPUT_MAP.forEach(m => {
            if (state.disabledStations.includes(m.st)) return;
            if (state.virtualSwitches[m.idx]) stationBytes[m.st] |= (1 << m.bit);
        });

        udpService.sendGlobalBroadcast(stationBytes);
        udpService.sendRemoteData(virtualBytes(state.virtualSwitches));

        if (!controlHandshakeConfirmed) {
            overrideAssertCounter++;
            if (overrideAssertCounter >= 5) { udpService.sendOverrideCommand(1); overrideAssertCounter = 0; }
        }
    }
}

function virtualBytes(switches) {
    const arr = [0, 0, 0];
    for (let i = 0; i < 24; i++) if (switches[i]) arr[Math.floor(i / 8)] |= (1 << (i % 8));
    return arr;
}

function checkHeartbeats() {
    // ✅ ALWAYS CHECK.
    const now = Date.now();
    let stateChanged = false;

    if (state.mainControllerOnline && (now - state.lastMainHeartbeat > 5000)) {
        console.log("[FAILSAFE] Main Controller Timed Out.");
        logSystemEvent('ALARM', "Main Controller LOST! Switching to Headless.");
        state.mainControllerOnline = false;
        if (state.controller === 'CABANE') {
            state.controller = 'SERVER';
            state.currentUser = null;
            udpService.sendOverrideCommand(1);
        }
        stateChanged = true;
    }
    for (let i = 0; i < 6; i++) {
        if (state.stationOnline[i] && (now - state.stationLastSeen[i] > 3000)) {
            state.stationOnline[i] = false;
            stateChanged = true;
        }
    }
    if (stateChanged) pushUpdate();
}

function pushUpdate() {
    if (!ioRef) return;
    const newStateStr = JSON.stringify(state);
    if (newStateStr !== lastPushedStateStr) {
        ioRef.emit('STATE_UPDATE', state);
        lastPushedStateStr = newStateStr;
    }
}

module.exports = {
    init, getFullState, updatePhysicalState, updateStationFeedback, updateStationHeartbeat,
    takeControl, releaseToServer, releaseToCabane, toggleSwitch, updateTimezone, updateDisabled, updateConfig
};