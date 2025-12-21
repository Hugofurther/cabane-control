// ============================================================
// 🤖 AUTOMATION SERVICE - PARALLEL BRANCHING + SHUTDOWN (v12)
// ============================================================
const db = require('../db');

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

// --- UTILS ---
const pulseSwitch = (idx) => {
    logicEngine.toggleSwitch(idx, 1, 'AUTO');
    setTimeout(() => logicEngine.toggleSwitch(idx, 0, 'AUTO'), 1000);
};
const setSwitch = (idx, val) => logicEngine.toggleSwitch(idx, val ? 1 : 0, 'AUTO');

const arePumpsStopped = (stId, bits) => {
    const state = logicEngine.getFullState();
    const fb = state.stationFeedback[stId];
    for (let bit of bits) { if (((fb >> bit) & 1) === 0) return false; }
    return true;
};
const isStationAvailable = (id) => !logicEngine.getFullState().disabledStations.includes(id);

// --- MAIN LOOP ---
function loop() {
    if (!status.active || status.paused) return;

    const state = logicEngine.getFullState();

    if (!state.simulationMode && !state.mainControllerOnline) {
        abortAll("Main Controller Offline");
        return;
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
// 💧 BRANCH 1 LOGIC (Main Pipeline) - CORRECTED
// ============================================================
function loopBranch1() {
    const b = status.branches[1];
    if (b.status === 'ERROR' || b.status === 'DONE') return;

    // ✅ SAFETY DELAY: 
    // Ignore feedback checks for the first 3 seconds of ANY step.
    // This allows pumps time to turn ON (Green) so we don't accidentally detect a "Stop" (Red) 
    // from the previous state.
    if (Date.now() - b.stepStart < 3000) return;

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
    // Vacuums ON
    [2, 3, 9, 14].forEach(i => setSwitch(i, true));
    // All Pumps Pulse
    [0, 1, 8, 12, 13].forEach(i => pulseSwitch(i));
    // Valves
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
    const b = status.branches[1]; b.step = 2; b.stepStart = Date.now(); // ✅ Reset Timer
    // Vacuums ON
    [2, 3, 9, 14].forEach(i => setSwitch(i, true));
    // Pumps Pulse (ST1 & ST2)
    if (arePumpsStopped(1, [0, 1])) { pulseSwitch(0); pulseSwitch(1); }
    if (arePumpsStopped(2, [0])) pulseSwitch(8);
    // Valves
    setSwitch(4, false); // VID T1
    setSwitch(5, false); // OUV T2
    setSwitch(6, true);  // VID T2
    setSwitch(7, false); // VID S2>S1
    setSwitch(10, false);// VID S1>S2
    setSwitch(11, true); // VID S3>S2
    setSwitch(15, true); // VID S2>S3
    emitUpdate();
}

function execB1_Step3() {
    const b = status.branches[1]; b.step = 3; b.stepStart = Date.now(); // ✅ Reset Timer
    // Vacuums ON
    [2, 3, 9, 14].forEach(i => setSwitch(i, true));
    // Pumps Pulse (ST1 only)
    pulseSwitch(0);
    pulseSwitch(1);
    // Valves
    setSwitch(4, false); // VID T1
    setSwitch(5, false); // OUV T2
    setSwitch(6, false); // VID T2
    setSwitch(7, true);  // VID S2>S1
    setSwitch(10, true); // VID S1>S2
    setSwitch(11, true); // VID S3>S2
    setSwitch(15, false); // VID S2>S3
    emitUpdate();
}

function execB1_Step4() {
    const b = status.branches[1]; b.step = 4; b.stepStart = Date.now();
    b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000);
    // Vacuums ON
    [2, 3, 9, 14].forEach(i => setSwitch(i, true));
    // Valves
    setSwitch(4, true);  // VID T1
    setSwitch(5, false); // OUV T2
    setSwitch(6, false); // VID T2
    setSwitch(7, true);  // VID S2>S1
    setSwitch(10, true); // VID S1>S2
    setSwitch(11, false); // VID S3>S2
    setSwitch(15, false); // VID S2>S3
    emitUpdate();
}

function execB1_Step5() {
    const b = status.branches[1]; b.step = 5; b.active = false; b.status = 'DONE';
    // Vacuums ON (as per doc)
    setSwitch(2, true);
    setSwitch(3, true);
    setSwitch(9, true);
    setSwitch(14, true);
    // Thermostat ON
    setSwitch(22, true);
    // All other valves OFF
    [4, 5, 6, 7, 10, 11, 15].forEach(i => setSwitch(i, false));
    emitUpdate();
}

// --- BRANCH 2 & 3 ---
function loopBranch2() {
    const b = status.branches[2];
    if (b.status === 'ERROR' || b.status === 'DONE') return;
    if (Date.now() - b.stepStart < 3000) return; // ✅ Safety Delay
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

function loopBranch3() {
    const b = status.branches[3];
    if (b.status === 'ERROR' || b.status === 'DONE') return;
    if (Date.now() - b.stepStart < 3000) return; // ✅ Safety Delay
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
    for (let i = 0; i < 24; i++) setSwitch(i, i === 22 || i === 23);
    complete();
}
function startStandaloneShutdown(username, durationMin) {
    if (status.active) return;
    const dur = parseInt(durationMin) || 60;
    status.active = true;
    status.mode = 'SHUTDOWN_ONLY';
    status.startTime = Date.now();
    status.shutdownPending = true;
    status.shutdownDelayMin = dur;
    status.globalTimerEnd = Date.now() + (dur * 60 * 1000);
    emitUpdate();
}
function startSequence(username, opts = {}) {
    if (status.active) return;
    status.active = true;
    status.paused = false;
    status.mode = 'SEQUENCE';
    status.startTime = Date.now();
    status.shutdownPending = !!opts.shutdownEnabled;
    status.shutdownDelayMin = parseInt(opts.shutdownDuration) || config.shutdown_timer_min;
    for (let i = 1; i <= 3; i++) status.branches[i] = { active: true, step: 0, status: 'IDLE', error: null, stepStart: 0, timerEnd: 0 };
    execB1_Step1(); execB2_Step1(); execB3_Step1();
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