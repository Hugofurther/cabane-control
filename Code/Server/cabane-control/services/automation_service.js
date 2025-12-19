// ============================================================
// 🤖 AUTOMATION SERVICE - PARALLEL BRANCHING + SHUTDOWN (v11)
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
    // console.log(`[AUTO] Pulsing Switch ${idx}`);
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

    // Safety
    if (!state.simulationMode && !state.mainControllerOnline) {
        abortAll("Main Controller Offline");
        return;
    }

    // 1. STANDALONE SHUTDOWN MODE
    if (status.mode === 'SHUTDOWN_ONLY') {
        const remaining = Math.floor((status.globalTimerEnd - Date.now()) / 1000);
        if (remaining % 30 === 0 && remaining > 0) console.log(`[AUTO] Shutdown Only: ${remaining}s remaining`);

        if (Date.now() >= status.globalTimerEnd) {
            executeGlobalShutdown();
        }
        return;
    }

    // 2. SEQUENCE MODE
    if (status.mode === 'SEQUENCE') {
        if (status.branches[1].active) loopBranch1();
        if (status.branches[2].active) loopBranch2();
        if (status.branches[3].active) loopBranch3();

        // Check Completion
        const allDone = !status.branches[1].active && !status.branches[2].active && !status.branches[3].active;

        if (allDone) {
            if (status.shutdownPending) {
                console.log(`[AUTO] 🏁 Sequence Done. Switching to SHUTDOWN_WAIT. Duration: ${status.shutdownDelayMin}m`);
                status.mode = 'SHUTDOWN_WAIT';
                status.globalTimerEnd = Date.now() + (status.shutdownDelayMin * 60 * 1000);
                emitUpdate();
            } else {
                console.log("[AUTO] Sequence Done. No Shutdown Pending. Finishing.");
                complete();
            }
        }
        return;
    }

    // 3. SHUTDOWN WAIT MODE (Post-Sequence)
    if (status.mode === 'SHUTDOWN_WAIT') {
        const remaining = Math.floor((status.globalTimerEnd - Date.now()) / 1000);
        if (remaining % 30 === 0 && remaining > 0) console.log(`[AUTO] Shutdown Wait: ${remaining}s remaining`);

        if (Date.now() >= status.globalTimerEnd) {
            executeGlobalShutdown();
        }
    }
}

// --- BRANCH 1 ---
function loopBranch1() {
    const b = status.branches[1]; if (b.status === 'ERROR' || b.status === 'DONE') return;
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
    [2, 3, 9, 14].forEach(i => setSwitch(i, true));[0, 1, 8, 12, 13].forEach(i => pulseSwitch(i)); setSwitch(5, false); setSwitch(6, true); setSwitch(7, false); emitUpdate();
}
function execB1_Step2() { const b = status.branches[1]; b.step = 2;[2, 3, 9, 14].forEach(i => setSwitch(i, true)); if (arePumpsStopped(1, [0, 1])) { pulseSwitch(0); pulseSwitch(1); } if (arePumpsStopped(2, [0])) pulseSwitch(8); setSwitch(15, true); setSwitch(11, true); setSwitch(4, false); setSwitch(5, false); setSwitch(6, true); setSwitch(7, false); emitUpdate(); }
function execB1_Step3() { const b = status.branches[1]; b.step = 3;[2, 3, 9, 14].forEach(i => setSwitch(i, true)); pulseSwitch(0); pulseSwitch(1); setSwitch(10, true); setSwitch(7, true); setSwitch(15, false); setSwitch(6, false); emitUpdate(); }
function execB1_Step4() { const b = status.branches[1]; b.step = 4; b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000);[2, 3, 9, 14].forEach(i => setSwitch(i, true)); setSwitch(4, true); setSwitch(10, true); setSwitch(11, false); setSwitch(7, true); emitUpdate(); }
function execB1_Step5() { const b = status.branches[1]; b.step = 5; b.active = false; b.status = 'DONE'; setSwitch(2, true); setSwitch(3, false); setSwitch(22, true); setSwitch(4, false); setSwitch(5, false); setSwitch(6, false); setSwitch(7, false); setSwitch(9, true); setSwitch(10, false); setSwitch(11, false); setSwitch(14, true); setSwitch(15, false); emitUpdate(); }

// --- BRANCH 2 ---
function loopBranch2() { const b = status.branches[2]; if (b.status === 'ERROR' || b.status === 'DONE') return; try { switch (b.step) { case 1: if (arePumpsStopped(4, [0])) execB2_Step2(); break; case 2: if (Date.now() >= b.timerEnd) execB2_Step3(); break; } } catch (e) { failBranch(2, e.message); } }
function execB2_Step1() { if (!isStationAvailable(4)) { failBranch(2, "ST4 Disabled"); return; } const b = status.branches[2]; b.step = 1; b.active = true; b.status = 'RUNNING'; b.stepStart = Date.now(); setSwitch(17, true); pulseSwitch(16); setSwitch(18, false); emitUpdate(); }
function execB2_Step2() { const b = status.branches[2]; b.step = 2; b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000); setSwitch(17, true); setSwitch(18, true); emitUpdate(); }
function execB2_Step3() { const b = status.branches[2]; b.step = 3; b.active = false; b.status = 'DONE'; setSwitch(17, true); setSwitch(18, false); setSwitch(23, true); emitUpdate(); }

// --- BRANCH 3 ---
function loopBranch3() { const b = status.branches[3]; if (b.status === 'ERROR' || b.status === 'DONE') return; try { switch (b.step) { case 1: if (arePumpsStopped(5, [0])) execB3_Step2(); break; case 2: if (Date.now() >= b.timerEnd) execB3_Step3(); break; } } catch (e) { failBranch(3, e.message); } }
function execB3_Step1() { if (!isStationAvailable(5)) { failBranch(3, "ST5 Disabled"); return; } const b = status.branches[3]; b.step = 1; b.active = true; b.status = 'RUNNING'; b.stepStart = Date.now(); setSwitch(17, true); pulseSwitch(19); setSwitch(20, false); emitUpdate(); }
function execB3_Step2() { const b = status.branches[3]; b.step = 2; b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000); setSwitch(17, true); setSwitch(20, true); emitUpdate(); }
function execB3_Step3() { const b = status.branches[3]; b.step = 3; b.active = false; b.status = 'DONE'; setSwitch(17, true); setSwitch(20, false); emitUpdate(); }

// ============================================================
// 🛑 SHUTDOWN LOGIC
// ============================================================

function executeGlobalShutdown() {
    console.log("[AUTO] Executing Global Shutdown (Valves/Pumps OFF, Thermostats ON)");

    // ✅ Turn everything OFF EXCEPT Thermostats (22, 23) which turn ON
    for (let i = 0; i < 24; i++) {
        if (i === 22 || i === 23) {
            setSwitch(i, true); // Thermostats ON
        } else {
            setSwitch(i, false); // Everything else OFF
        }
    }
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

    console.log(`[AUTO] Standalone Shutdown by ${username}. T-Minus ${dur}m.`);
    emitUpdate();
}

// ============================================================
// 🕹️ PUBLIC API
// ============================================================

function startSequence(username, opts = {}) {
    if (status.active) return;
    const state = logicEngine.getFullState();
    if (!state.simulationMode && !state.mainControllerOnline) throw new Error("Main Offline");

    status.active = true;
    status.paused = false;
    status.mode = 'SEQUENCE';
    status.startTime = Date.now();

    // ✅ LOGGING TO DEBUG API HIT
    console.log("[AUTO] Start Params Received:", JSON.stringify(opts));

    status.shutdownPending = !!opts.shutdownEnabled;
    status.shutdownDelayMin = parseInt(opts.shutdownDuration) || config.shutdown_timer_min;

    // Reset Branches
    for (let i = 1; i <= 3; i++) status.branches[i] = { active: true, step: 0, status: 'IDLE', error: null, stepStart: 0, timerEnd: 0 };

    execB1_Step1(); execB2_Step1(); execB3_Step1();

    console.log(`[AUTO] Sequence Started by ${username}. Shutdown=${status.shutdownPending} (${status.shutdownDelayMin}m)`);
    emitUpdate();
}

function pause() { status.paused = true; emitUpdate(); }
function resume() { status.paused = false; emitUpdate(); }
function stop() { abortAll("User Stopped"); }

function abortAll(reason) {
    console.error(`[AUTO] Abort: ${reason}`);
    status.active = false;
    status.mode = 'SEQUENCE';
    status.shutdownPending = false;
    for (let i = 1; i <= 3; i++) status.branches[i].active = false;
    emitUpdate();
}

function failBranch(id, reason) {
    const b = status.branches[id]; b.active = false; b.status = 'ERROR'; b.error = reason;
    console.error(`[AUTO] Branch ${id} Failed: ${reason}`);
    emitUpdate();
}

function complete() {
    console.log("[AUTO] Process Complete.");
    status.active = false;
    status.shutdownPending = false;
    status.mode = 'SEQUENCE';
    emitUpdate();
}

function emitUpdate() { if (ioRef) ioRef.emit('AUTO_UPDATE', status); }
function getStatus() { return status; }
function getConfig() { return config; }
function jump(step) { }

module.exports = { init, startSequence, startStandaloneShutdown, pause, resume, stop, getStatus, getConfig, reloadSettings, jump };