// ============================================================
// 🤖 AUTOMATION SERVICE - PARALLEL BRANCHING (v4.1 - Step 2 Fixes)
// ============================================================
const db = require('../db');

let logicEngine = null;
let ioRef = null;

let config = { drain_timer_min: 15 };

// --- RUNTIME STATE ---
let status = {
    active: false,
    paused: false,
    branches: {
        1: { active: false, step: 0, status: 'IDLE', error: null, stepStart: 0, timerEnd: 0 },
        2: { active: false, step: 0, status: 'IDLE', error: null, stepStart: 0, timerEnd: 0 },
        3: { active: false, step: 0, status: 'IDLE', error: null, stepStart: 0, timerEnd: 0 }
    },
    startTime: 0
};

let checkInterval = null;

// --- MAPPINGS ---
// [SwitchIdx, FeedbackStationID, FeedbackBit]
const PUMPS = {
    ST1: [0, 1], // St 1 Bits 0,1
    ST2: [8],    // St 2 Bit 0
    ST3: [12, 13], // St 3 Bits 0,1
    ST4: [16],   // St 4 Bit 0
    ST5: [19]    // St 5 Bit 0
};

function init(engine, io) {
    logicEngine = engine;
    ioRef = io;
    loadSettings();
    checkInterval = setInterval(loop, 1000);
}

function loadSettings() {
    db.all("SELECT key, value FROM system_settings", (err, rows) => {
        if (rows) rows.forEach(row => { if (row.key === 'drain_timer_min') config.drain_timer_min = parseInt(row.value) || 15; });
    });
}

// --- UTILS ---
const pulseSwitch = (idx) => {
    console.log(`[AUTO] Pulsing Switch ${idx}`);
    logicEngine.toggleSwitch(idx, 1, 'AUTO');
    setTimeout(() => logicEngine.toggleSwitch(idx, 0, 'AUTO'), 1000);
};

const setSwitch = (idx, val) => {
    console.log(`[AUTO] Set Switch ${idx} to ${val}`);
    logicEngine.toggleSwitch(idx, val ? 1 : 0, 'AUTO');
};

const arePumpsStopped = (stationId, bits) => {
    const state = logicEngine.getFullState();
    const fb = state.stationFeedback[stationId];
    // Active Low Feedback: 0=Running, 1=Stopped
    // We want ALL bits to be 1
    for (let bit of bits) { if (((fb >> bit) & 1) === 0) return false; }
    return true;
};

const isStationAvailable = (id) => {
    const state = logicEngine.getFullState();
    if (state.disabledStations.includes(id)) return false;
    return true;
};

// --- MAIN LOOP ---
function loop() {
    if (!status.active || status.paused) return;

    const state = logicEngine.getFullState();

    // Bypass safety check if in simulation mode
    if (!state.simulationMode && !state.mainControllerOnline) {
        abortAll("Main Controller Offline");
        return;
    }

    // Run each branch logic
    if (status.branches[1].active) loopBranch1();
    if (status.branches[2].active) loopBranch2();
    if (status.branches[3].active) loopBranch3();

    // Check Global Completion
    if (!status.branches[1].active && !status.branches[2].active && !status.branches[3].active) {
        console.log("[AUTO] All branches finished.");
        status.active = false;
        emitUpdate();
    }
}

// ============================================================
// 🌿 BRANCH 1: MAIN PIPELINE (ST1-ST2-ST3)
// ============================================================
function loopBranch1() {
    const b = status.branches[1];
    if (b.status === 'ERROR' || b.status === 'DONE') return;

    try {
        switch (b.step) {
            case 1: // Wait for ST3 Pumps
                if (arePumpsStopped(3, [0, 1])) execB1_Step2();
                break;
            case 2: // Wait for ST2 Pump
                if (arePumpsStopped(2, [0])) execB1_Step3();
                break;
            case 3: // Wait for ST1 Pumps
                if (arePumpsStopped(1, [0, 1])) execB1_Step4();
                break;
            case 4: // Timer
                if (Date.now() >= b.timerEnd) execB1_Step5();
                break;
        }
    } catch (e) { failBranch(1, e.message); }
}

function execB1_Step1() {
    console.log("[AUTO] B1 Step 1");
    if (!isStationAvailable(1) || !isStationAvailable(2) || !isStationAvailable(3)) {
        failBranch(1, "Stations Disabled"); return;
    }

    const b = status.branches[1]; b.step = 1; b.status = 'RUNNING'; b.stepStart = Date.now();

    // 1. Ensure Vacuum ON: ST0 (2,3), ST2 (9), ST3 (14)
    [2, 3, 9, 14].forEach(i => setSwitch(i, true));

    // 2. Pulse Transport Pumps: ST1 (0,1), ST2 (8), ST3 (12,13)
    [0, 1, 8, 12, 13].forEach(i => pulseSwitch(i));

    // 3. Valves
    setSwitch(5, false); // Close T2 (ST1-Cabane)
    setSwitch(6, true);  // Open Drain T2->ST1

    emitUpdate();
}

function execB1_Step2() {
    console.log("[AUTO] B1 Step 2");
    const b = status.branches[1]; b.step = 2; b.stepStart = Date.now();

    // ✅ 1. Ensure Vacuum ON: ST0 (2,3), ST2 (9), ST3 (14)
    [2, 3, 9, 14].forEach(i => setSwitch(i, true));

    // ✅ 2. Pulse Transport Pumps: ST1 (0,1), ST2 (8)
    // Pulse only if they are stopped (to avoid interrupting running pumps if they are latching)
    if (arePumpsStopped(1, [0, 1])) { pulseSwitch(0); pulseSwitch(1); }
    if (arePumpsStopped(2, [0])) pulseSwitch(8);

    // 3. Valves
    setSwitch(15, true); // Drain ST2 > ST3
    setSwitch(11, true); // Drain ST3 > ST2
    emitUpdate();
}

function execB1_Step3() {
    console.log("[AUTO] B1 Step 3");
    const b = status.branches[1]; b.step = 3; b.stepStart = Date.now();

    // Check ST1 Pumps. If Stopped, Pulse.
    if (arePumpsStopped(1, [0, 1])) { pulseSwitch(0); pulseSwitch(1); }

    setSwitch(10, true); // ST1 > ST2
    setSwitch(7, true);  // ST2 > ST1
    setSwitch(15, false); // Close ST2 > ST3
    setSwitch(6, false);  // Close T2 > ST1
    emitUpdate();
}

function execB1_Step4() {
    console.log("[AUTO] B1 Step 4");
    const b = status.branches[1]; b.step = 4; b.stepStart = Date.now();
    b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000);

    setSwitch(4, true);  // Open T1 > ST1
    setSwitch(10, false); // Close ST1 > ST2
    setSwitch(11, false); // Close ST3 > ST2
    emitUpdate();
}

function execB1_Step5() {
    console.log("[AUTO] B1 FINISHED");
    const b = status.branches[1]; b.step = 5; b.status = 'DONE';

    setSwitch(4, false); // Close T1 > ST1
    setSwitch(7, false); // Close ST2 > ST1
    setSwitch(22, true); // Enable TH1
    b.active = false;
    emitUpdate();
}


// ============================================================
// 🌿 BRANCH 2: STATION 4
// ============================================================
function loopBranch2() {
    const b = status.branches[2];
    if (b.status === 'ERROR' || b.status === 'DONE') return;

    try {
        switch (b.step) {
            case 1: // Wait for ST4 Pump
                if (arePumpsStopped(4, [0])) execB2_Step2();
                break;
            case 2: // Timer
                if (Date.now() >= b.timerEnd) execB2_Step3();
                break;
        }
    } catch (e) { failBranch(2, e.message); }
}

function execB2_Step1() {
    console.log("[AUTO] B2 Step 1");
    if (!isStationAvailable(4)) { failBranch(2, "ST4 Disabled"); return; }

    const b = status.branches[2]; b.step = 1; b.status = 'RUNNING'; b.stepStart = Date.now();

    // 1. Ensure Vacuum ON: ST4 (17)
    setSwitch(17, true);

    // 2. Pulse Pump: ST4 (16)
    pulseSwitch(16);

    emitUpdate();
}

function execB2_Step2() {
    console.log("[AUTO] B2 Step 2");
    const b = status.branches[2]; b.step = 2; b.stepStart = Date.now();
    b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000);

    // ✅ Ensure Vacuum ON: ST4 (17)
    setSwitch(17, true);

    setSwitch(18, true); // Open Cabane->ST4
    emitUpdate();
}

function execB2_Step3() {
    console.log("[AUTO] B2 FINISHED");
    const b = status.branches[2]; b.step = 3; b.status = 'DONE';

    setSwitch(18, false); // Close Cabane->ST4
    setSwitch(23, true);  // Enable TH2
    b.active = false;
    emitUpdate();
}

// ============================================================
// 🌿 BRANCH 3: STATION 5
// ============================================================
function loopBranch3() {
    const b = status.branches[3];
    if (b.status === 'ERROR' || b.status === 'DONE') return;

    try {
        switch (b.step) {
            case 1: // Wait for ST5 Pump
                if (arePumpsStopped(5, [0])) execB3_Step2();
                break;
            case 2: // Timer
                if (Date.now() >= b.timerEnd) execB3_Step3();
                break;
        }
    } catch (e) { failBranch(3, e.message); }
}

function execB3_Step1() {
    console.log("[AUTO] B3 Step 1");
    if (!isStationAvailable(5)) { failBranch(3, "ST5 Disabled"); return; }

    const b = status.branches[3]; b.step = 1; b.status = 'RUNNING'; b.stepStart = Date.now();

    // 1. Ensure Vacuum ON: ST4 (17) - ST5 uses ST4 Vacuum
    setSwitch(17, true);

    // 2. Pulse Pump: ST5 (19)
    pulseSwitch(19);

    emitUpdate();
}

function execB3_Step2() {
    console.log("[AUTO] B3 Step 2");
    const b = status.branches[3]; b.step = 2; b.stepStart = Date.now();
    b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000);

    // ✅ Ensure Vacuum ON: ST4 (17) - ST5 uses ST4 Vacuum
    setSwitch(17, true);

    setSwitch(20, true); // Open ST5->Cabane
    emitUpdate();
}

function execB3_Step3() {
    console.log("[AUTO] B3 FINISHED");
    const b = status.branches[3]; b.step = 3; b.status = 'DONE';

    setSwitch(20, false); // Close ST5->Cabane
    b.active = false;
    emitUpdate();
}

// ============================================================
// 🕹️ PUBLIC API
// ============================================================

function startSequence(username) {
    if (status.active) return;

    const state = logicEngine.getFullState();

    if (!state.simulationMode && !state.mainControllerOnline) {
        throw new Error("Main Controller Offline");
    }

    status.active = true;
    status.paused = false;
    status.startTime = Date.now();

    // Reset all branches
    for (let i = 1; i <= 3; i++) {
        status.branches[i] = { active: true, step: 0, status: 'IDLE', error: null, stepStart: 0, timerEnd: 0 };
    }

    // Launch all 3
    execB1_Step1();
    execB2_Step1();
    execB3_Step1();

    console.log(`[AUTO] Full Sequence Started by ${username}`);
    emitUpdate();
}

function pause() { status.paused = true; emitUpdate(); }
function resume() { status.paused = false; emitUpdate(); }

function stop() {
    abortAll("User Stopped");
}

function abortAll(reason) {
    console.error(`[AUTO] Abort All: ${reason}`);
    status.active = false;
    for (let i = 1; i <= 3; i++) {
        if (status.branches[i].active) {
            status.branches[i].active = false;
            status.branches[i].status = 'ABORTED';
            status.branches[i].error = reason;
        }
    }
    emitUpdate();
}

function failBranch(id, reason) {
    console.error(`[AUTO] Branch ${id} Failed: ${reason}`);
    const b = status.branches[id];
    b.active = false;
    b.status = 'ERROR';
    b.error = reason;
    emitUpdate();
}

function emitUpdate() { if (ioRef) ioRef.emit('AUTO_UPDATE', status); }
function getStatus() { return status; }

module.exports = { init, startSequence, pause, resume, stop, getStatus };