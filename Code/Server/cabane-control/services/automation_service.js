// ============================================================
// 🤖 AUTOMATION SERVICE - PARALLEL BRANCHING (v6 - Strict Safety)
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

function reloadSettings() {
    loadSettings();
    console.log("[AUTO] Settings Reloaded");
}

// --- UTILS ---
const pulseSwitch = (idx) => {
    // Pulse logic usually means turn ON momentarily. 
    // If we want to ensure pumps are running (latched), we might just turn them ON.
    // Assuming "Pulse ON 1 sec" means momentary push to start.
    console.log(`[AUTO] Pulsing Switch ${idx}`);
    logicEngine.toggleSwitch(idx, 1, 'AUTO');
    setTimeout(() => logicEngine.toggleSwitch(idx, 0, 'AUTO'), 1000);
};

const setSwitch = (idx, val) => {
    // console.log(`[AUTO] Set Switch ${idx} to ${val}`);
    logicEngine.toggleSwitch(idx, val ? 1 : 0, 'AUTO');
};

const arePumpsStopped = (stationId, bits) => {
    const state = logicEngine.getFullState();
    const fb = state.stationFeedback[stationId];
    // Active Low Feedback: 0=Running, 1=Stopped
    // We want ALL bits to be 1 to return true (All Stopped)
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

    // --- ST0 ---
    setSwitch(2, true);  // Vac 1
    setSwitch(3, true);  // Vac 2
    // TH1 N/A (Keep as is or force off? Spec says N/A, usually means ignore)

    // --- ST1 ---
    pulseSwitch(0); // Transp 1
    pulseSwitch(1); // Transp 2
    setSwitch(4, false); // Empty T1
    setSwitch(5, false); // Open T2
    setSwitch(6, true);  // Empty T2
    setSwitch(7, false); // Empty ST2->ST1 (Fixed idx from spec: "Empty Valve ST2 -> ST1 [idx 6]" -> Spec typo, ST1 idx 6 is used twice? 
    // Looking at INPUT_MAP: ST1 idx 6 is Pin 68 (Vid T2). ST1 idx 7 is Pin 69 (Vid ST2->ST1).
    // Assuming idx 7 for ST2->ST1 based on standard layout.

    // --- ST2 ---
    pulseSwitch(8); // Transp
    setSwitch(9, true);  // Vac
    setSwitch(10, false); // Empty ST1->ST2
    setSwitch(11, false); // Empty ST3->ST2

    // --- ST3 ---
    pulseSwitch(12); // Transp 1
    pulseSwitch(13); // Transp 2
    setSwitch(14, true); // Vac
    setSwitch(15, false); // Empty ST2->ST3

    emitUpdate();
}

function execB1_Step2() {
    console.log("[AUTO] B1 Step 2");
    const b = status.branches[1]; b.step = 2; b.stepStart = Date.now();

    // --- ST0 ---
    setSwitch(2, true);
    setSwitch(3, true);

    // --- ST1 ---
    pulseSwitch(0);
    pulseSwitch(1);
    setSwitch(4, false);
    setSwitch(5, false);
    setSwitch(6, true);
    setSwitch(7, false);

    // --- ST2 ---
    pulseSwitch(8);
    setSwitch(9, true);
    setSwitch(10, false);
    setSwitch(11, true); // ✅ ON

    // --- ST3 ---
    // NO Pulse (Stay OFF implicitly if not latched, or ignore pulsing)
    setSwitch(14, true);
    setSwitch(15, true); // ✅ ON

    emitUpdate();
}

function execB1_Step3() {
    console.log("[AUTO] B1 Step 3");
    const b = status.branches[1]; b.step = 3; b.stepStart = Date.now();

    // --- ST0 ---
    setSwitch(2, true);
    setSwitch(3, true);

    // --- ST1 ---
    pulseSwitch(0);
    pulseSwitch(1);
    setSwitch(4, false);
    setSwitch(5, false);
    setSwitch(6, false); // ✅ OFF
    setSwitch(7, true);  // ✅ ON (Idx 7)

    // --- ST2 ---
    // NO Pulse
    setSwitch(9, true);
    setSwitch(10, true); // ✅ ON
    setSwitch(11, true); // ✅ ON (Keep ON)

    // --- ST3 ---
    // NO Pulse
    setSwitch(14, true);
    setSwitch(15, false); // ✅ OFF

    emitUpdate();
}

function execB1_Step4() {
    console.log("[AUTO] B1 Step 4");
    const b = status.branches[1]; b.step = 4; b.stepStart = Date.now();
    b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000);

    // --- ST0 ---
    setSwitch(2, true);
    setSwitch(3, true);

    // --- ST1 ---
    // NO Pulse
    setSwitch(4, true); // ✅ ON
    setSwitch(5, false);
    setSwitch(6, false);
    setSwitch(7, true); // ✅ Keep ON

    // --- ST2 ---
    // NO Pulse
    setSwitch(9, true);
    setSwitch(10, true);  // ✅ CORRECTED: ST1 > ST2 -> ON (Keep draining)
    setSwitch(11, false); // ✅ OFF

    // --- ST3 ---
    // NO Pulse
    setSwitch(14, true);
    setSwitch(15, false);

    emitUpdate();
}

function execB1_Step5() {
    console.log("[AUTO] B1 FINISHED");
    const b = status.branches[1]; b.step = 5; b.status = 'DONE';

    // --- ST0 ---
    setSwitch(2, true);
    setSwitch(3, false); // ✅ CORRECTED: Vacuum 2 -> OFF
    setSwitch(22, true); // ✅ TH1 ON

    // --- ST1 ---
    // NO Pulse
    setSwitch(4, false); // ✅ OFF
    setSwitch(5, false);
    setSwitch(6, false);
    setSwitch(7, false); // ✅ OFF

    // --- ST2 ---
    // NO Pulse
    setSwitch(9, true);
    setSwitch(10, false);
    setSwitch(11, false);

    // --- ST3 ---
    // NO Pulse
    setSwitch(14, true);
    setSwitch(15, false);

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
            case 1: // Pulse, then move to timer immediately? No, Pulse doesn't wait.
                // Spec doesn't say "Wait for Pump Stop", it just says "Pulse ON".
                // However, usually Step 1 is "Run", Step 2 is "Drain".
                // Assuming we move to Step 2 immediately or after pump stops?
                // Previous logic waited for pump stop. Keeping that for consistency with Branch 1.
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

    // ST4
    pulseSwitch(16);     // Transp
    setSwitch(17, true); // Vac
    setSwitch(18, false); // Empty ST4

    emitUpdate();
}

function execB2_Step2() {
    console.log("[AUTO] B2 Step 2");
    const b = status.branches[2]; b.step = 2; b.stepStart = Date.now();
    b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000);

    // ST4
    // No Pulse
    setSwitch(17, true);
    setSwitch(18, true); // ✅ ON

    emitUpdate();
}

function execB2_Step3() {
    console.log("[AUTO] B2 FINISHED");
    const b = status.branches[2]; b.step = 3; b.status = 'DONE';

    // ST4
    // No Pulse
    setSwitch(17, true);
    setSwitch(18, false); // ✅ OFF
    // TH2? Spec didn't explicitly say enable TH2 in step 3 finish, but usually good practice.
    // You did list "Enable ST4 Thermostats [idx 23 ON]" in previous prompt.
    // Assuming yes:
    setSwitch(23, true);

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
            case 1:
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

    // ST5
    pulseSwitch(19);     // Transp
    setSwitch(17, true); // Vac (ST4)
    setSwitch(20, false); // Empty ST5->Cabane

    emitUpdate();
}

function execB3_Step2() {
    console.log("[AUTO] B3 Step 2");
    const b = status.branches[3]; b.step = 2; b.stepStart = Date.now();
    b.timerEnd = Date.now() + (config.drain_timer_min * 60 * 1000);

    // ST5
    // No Pulse
    setSwitch(17, true);
    setSwitch(20, true); // ✅ ON

    emitUpdate();
}

function execB3_Step3() {
    console.log("[AUTO] B3 FINISHED");
    const b = status.branches[3]; b.step = 3; b.status = 'DONE';

    // ST5
    // No Pulse
    setSwitch(17, true);
    setSwitch(20, false); // ✅ OFF

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
function stop() { abortAll("User Stopped"); }

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
function jump(step) { /* debug */ }

module.exports = { init, startSequence, pause, resume, stop, getStatus, reloadSettings, jump };