// ============================================================
// 🤖 AUTOMATION SERVICE (v13 - Dual Target Support)
// ============================================================
const db = require('../db');
const simulationService = require('./simulation_service'); // ✅ Import

let logicEngine = null;
let ioRef = null;

let config = {
    drain_timer_min: 15,
    shutdown_timer_min: 60
};

// --- RUNTIME STATE ---
let status = {
    active: false,
    paused: false,
    mode: 'SEQUENCE', // 'SEQUENCE', 'SHUTDOWN_ONLY', 'SHUTDOWN_WAIT'
    target: 'REAL',   // 'REAL' or 'SIM'

    // Sequence State
    branches: {
        1: { active: false, step: 0, status: 'IDLE', error: null, stepStart: 0, timerEnd: 0 },
        2: { active: false, step: 0, status: 'IDLE', error: null, stepStart: 0, timerEnd: 0 },
        3: { active: false, step: 0, status: 'IDLE', error: null, stepStart: 0, timerEnd: 0 }
    },

    // Shutdown Specific
    shutdownPending: false,
    shutdownDelayMin: 0,
    globalTimerEnd: 0,

    startTime: 0
};

let checkInterval = null;

// [SwitchIdx, FeedbackStationID, FeedbackBit]
const PUMPS = { ST1: [0, 1], ST2: [8], ST3: [12, 13], ST4: [16], ST5: [19] };

function init(engine, io) {
    logicEngine = engine;
    ioRef = io;
    loadSettings();
    checkInterval = setInterval(loop, 1000);
}

function loadSettings() {
    db.all("SELECT key, value FROM system_settings", (err, rows) => {
        if (rows) rows.forEach(row => {
            if (row.key === 'drain_timer_min') config.drain_timer_min = parseInt(row.value) || 15;
            if (row.key === 'shutdown_timer_min') config.shutdown_timer_min = parseInt(row.value) || 60;
        });
    });
}

function reloadSettings() { loadSettings(); }

// ============================================================
// 🎯 ROUTING UTILS (The Magic Logic)
// ============================================================

const toggleTarget = (idx, val) => {
    if (status.target === 'SIM') {
        simulationService.toggleSimSwitch(idx, val);
    } else {
        logicEngine.toggleSwitch(idx, val ? 1 : 0, 'AUTO');
    }
};

const pulseSwitch = (idx) => {
    toggleTarget(idx, true);
    setTimeout(() => toggleTarget(idx, false), 1000);
};

const setSwitch = (idx, val) => toggleTarget(idx, val);

// Get Feedback from the correct source
const getFeedback = (stId, bit) => {
    if (status.target === 'SIM') {
        // Read from Simulator State
        const simState = simulationService.getStatus().state;
        if (!simState || !simState[stId]) return 1; // Default OFF/Open
        return (simState[stId].inputMask >> bit) & 1;
    } else {
        // Read from Logic Engine (Physical State)
        const state = logicEngine.getFullState();
        return (state.stationFeedback[stId] >> bit) & 1;
    }
};

const arePumpsStopped = (stId, bits) => {
    for (let bit of bits) {
        if (getFeedback(stId, bit) === 0) return false; // 0 = Active/Running
    }
    return true;
};

const isStationAvailable = (id) => {
    if (status.target === 'SIM') return true; // Always available in Sim
    return !logicEngine.getFullState().disabledStations.includes(id);
};

// --- MAIN LOOP ---
function loop() {
    if (!status.active || status.paused) return;

    // Safety Check only for Real Target
    if (status.target === 'REAL') {
        const state = logicEngine.getFullState();
        if (!state.mainControllerOnline) {
            abortAll("Main Controller Offline");
            return;
        }
    }

    if (status.mode === 'SHUTDOWN_ONLY') {
        if (Date.now() >= status.globalTimerEnd) {
            executeGlobalShutdown();
        }
        return;
    }

    if (status.mode === 'SEQUENCE') {
        if (status.branches[1].active) loopBranch1();
        if (status.branches[2].active) loopBranch2();
        if (status.branches[3].active) loopBranch3();

        const allDone = !status.branches[1].active && !status.branches[2].active && !status.branches[3].active;

        if (allDone) {
            if (status.shutdownPending) {
                status.mode = 'SHUTDOWN_WAIT';
                status.globalTimerEnd = Date.now() + (status.shutdownDelayMin * 60 * 1000);
                emitUpdate();
            } else {
                complete();
            }
        }
        return;
    }

    if (status.mode === 'SHUTDOWN_WAIT') {
        if (Date.now() >= status.globalTimerEnd) {
            executeGlobalShutdown();
        }
    }
}

// ============================================================
// 💧 BRANCH 1 LOGIC (Main Pipeline)
// ============================================================
function loopBranch1() {
    const b = status.branches[1];
    if (b.status === 'ERROR' || b.status === 'DONE') return;
    if (Date.now() - b.stepStart < 3000) return; // ✅ Safety Delay

    try {
        switch (b.step) {
            case 1: if (arePumpsStopped(3, [0, 1])) execB1_Step2(); break;
            case 2: if (arePumpsStopped(2, [0])) execB1_Step3(); break;
            case 3: if (arePumpsStopped(1, [0, 1])) execB1_Step4(); break;
            case 4: if (Date.now() >= b.timerEnd) execB1_Step5(); break;
        }
    } catch (e) { failBranch(1, e.message); }
}

function execB1_Step1() {
    if (!isStationAvailable(1) || !isStationAvailable(2) || !isStationAvailable(3)) { failBranch(1, "Stations Disabled"); return; }
    const b = status.branches[1]; b.step = 1; b.active = true; b.status = 'RUNNING'; b.stepStart = Date.now();

    [2, 3, 9, 14].forEach(i => setSwitch(i, true)); // Vacuums ON
    [0, 1, 8, 12, 13].forEach(i => pulseSwitch(i)); // Pumps Pulse

    setSwitch(4, false); // VID T1
    setSwitch(5, false); // OUV T2
    setSwitch(6, true);  // VID T2
    setSwitch(7, false); // VID S2>S1
    setSwitch(10, false);// VID S1>S2
    setSwitch(11, false);// VID S3>S2
    setSwitch(15, false);// VID S2>S3
    emitUpdate();
}

function execB1_Step2() {
    const b = status.branches[1]; b.step = 2; b.stepStart = Date.now();
    [2, 3, 9, 14].forEach(i => setSwitch(i, true));
    if (arePumpsStopped(1, [0, 1])) { pulseSwitch(0); pulseSwitch(1); }
    if (arePumpsStopped(2, [0])) pulseSwitch(8);
    setSwitch(4, false); setSwitch(5, false); setSwitch(6, true); setSwitch(7, false);
    setSwitch(10, false); setSwitch(11, true); setSwitch(15, true);
    emitUpdate();
}

function execB1_Step3() {
    const b = status.branches[1]; b.step = 3; b.stepStart = Date.now();
    [2, 3, 9, 14].forEach(i => setSwitch(i, true));
    pulseSwitch(0); pulseSwitch(1);
    setSwitch(4, false); setSwitch(5, false); setSwitch(6, false); setSwitch(7, true);
    setSwitch(10, true); setSwitch(11, true); setSwitch(15, false);
    emitUpdate();
}

function execB1_Step4() {
    const b = status.branches[1]; b.step = 4; b.stepStart = Date.now();
    b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000);
    [2, 3, 9, 14].forEach(i => setSwitch(i, true));
    setSwitch(4, true); setSwitch(5, false); setSwitch(6, false); setSwitch(7, true);
    setSwitch(10, true); setSwitch(11, false); setSwitch(15, false);
    emitUpdate();
}

function execB1_Step5() {
    const b = status.branches[1]; b.step = 5; b.active = false; b.status = 'DONE';
    setSwitch(2, true); setSwitch(3, true); setSwitch(9, true); setSwitch(14, true); // Vacuums
    setSwitch(22, true); // Thermostat ON
    [4, 5, 6, 7, 10, 11, 15].forEach(i => setSwitch(i, false)); // Valves OFF
    emitUpdate();
}

// --- BRANCH 2 ---
function loopBranch2() {
    const b = status.branches[2];
    if (b.status === 'ERROR' || b.status === 'DONE') return;
    if (Date.now() - b.stepStart < 3000) return;
    try {
        switch (b.step) {
            case 1: if (arePumpsStopped(4, [0])) execB2_Step2(); break;
            case 2: if (Date.now() >= b.timerEnd) execB2_Step3(); break;
        }
    } catch (e) { failBranch(2, e.message); }
}
function execB2_Step1() { if (!isStationAvailable(4)) { failBranch(2, "ST4 Disabled"); return; } const b = status.branches[2]; b.step = 1; b.active = true; b.status = 'RUNNING'; b.stepStart = Date.now(); setSwitch(17, true); pulseSwitch(16); setSwitch(18, false); emitUpdate(); }
function execB2_Step2() { const b = status.branches[2]; b.step = 2; b.stepStart = Date.now(); b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000); setSwitch(17, true); setSwitch(18, true); emitUpdate(); }
function execB2_Step3() { const b = status.branches[2]; b.step = 3; b.active = false; b.status = 'DONE'; setSwitch(17, true); setSwitch(18, false); setSwitch(23, true); emitUpdate(); }

// --- BRANCH 3 ---
function loopBranch3() {
    const b = status.branches[3];
    if (b.status === 'ERROR' || b.status === 'DONE') return;
    if (Date.now() - b.stepStart < 3000) return;
    try {
        switch (b.step) {
            case 1: if (arePumpsStopped(5, [0])) execB3_Step2(); break;
            case 2: if (Date.now() >= b.timerEnd) execB3_Step3(); break;
        }
    } catch (e) { failBranch(3, e.message); }
}
function execB3_Step1() { if (!isStationAvailable(5)) { failBranch(3, "ST5 Disabled"); return; } const b = status.branches[3]; b.step = 1; b.active = true; b.status = 'RUNNING'; b.stepStart = Date.now(); setSwitch(17, true); pulseSwitch(19); setSwitch(20, false); emitUpdate(); }
function execB3_Step2() { const b = status.branches[3]; b.step = 2; b.stepStart = Date.now(); b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000); setSwitch(17, true); setSwitch(20, true); emitUpdate(); }
function execB3_Step3() { const b = status.branches[3]; b.step = 3; b.active = false; b.status = 'DONE'; setSwitch(17, true); setSwitch(20, false); emitUpdate(); }

// --- SHUTDOWN & CONTROL ---
function executeGlobalShutdown() {
    // Shutdown = Turn everything OFF, except Thermostats (ON)
    for (let i = 0; i < 24; i++) setSwitch(i, i === 22 || i === 23);
    complete();
}

function startStandaloneShutdown(username, durationMin) {
    if (status.active) return;
    const dur = parseInt(durationMin) || 60;

    // Detect Target
    const simStatus = simulationService.getStatus();
    const isSimOwner = simStatus.active && simStatus.owner === username;
    status.target = isSimOwner ? 'SIM' : 'REAL';

    status.active = true;
    status.mode = 'SHUTDOWN_ONLY';
    status.startTime = Date.now();
    status.shutdownPending = true;
    status.shutdownDelayMin = dur;
    status.globalTimerEnd = Date.now() + (dur * 60 * 1000);
    emitUpdate();
}

// ✅ PUBLIC API
function startSequence(username, opts = {}) {
    if (status.active) return;

    // ✅ DETECT TARGET
    const simStatus = simulationService.getStatus();
    const isSimOwner = simStatus.active && simStatus.owner === username;
    status.target = isSimOwner ? 'SIM' : 'REAL';

    if (status.target === 'REAL') {
        const state = logicEngine.getFullState();
        if (!state.mainControllerOnline) throw new Error("Main Offline");
    }

    status.active = true;
    status.paused = false;
    status.mode = 'SEQUENCE';
    status.startTime = Date.now();
    status.shutdownPending = !!opts.shutdownEnabled;
    status.shutdownDelayMin = parseInt(opts.shutdownDuration) || config.shutdown_timer_min;

    for (let i = 1; i <= 3; i++) status.branches[i] = { active: true, step: 0, status: 'IDLE', error: null, stepStart: 0, timerEnd: 0 };

    execB1_Step1(); execB2_Step1(); execB3_Step1();

    console.log(`[AUTO] Started by ${username} on target: ${status.target}`);
    emitUpdate();
}

function pause() { status.paused = true; emitUpdate(); }
function resume() { status.paused = false; emitUpdate(); }
function stop() { abortAll("User Stopped"); }

function abortAll(reason) {
    status.active = false;
    status.mode = 'SEQUENCE';
    status.shutdownPending = false;
    for (let i = 1; i <= 3; i++) status.branches[i].active = false;
    emitUpdate();
}

function failBranch(id, reason) { const b = status.branches[id]; b.active = false; b.status = 'ERROR'; b.error = reason; emitUpdate(); }
function complete() { status.active = false; status.shutdownPending = false; status.mode = 'SEQUENCE'; emitUpdate(); }
function emitUpdate() { if (ioRef) ioRef.emit('AUTO_UPDATE', status); }
function getStatus() { return status; }
function getConfig() { return config; }
function jump(step) { }

module.exports = { init, startSequence, startStandaloneShutdown, pause, resume, stop, getStatus, getConfig, reloadSettings, jump };