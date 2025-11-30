// ============================================================
// 🧠 LOGIC ENGINE (State Machine) - v6 SYNC FIX
// ============================================================
const udpService = require('./udp_service');

const state = {
    // Modes: 'CABANE', 'SERVER', 'USER'
    controller: 'CABANE',
    currentUser: null,

    mainControllerOnline: false,
    lastMainHeartbeat: 0,

    virtualSwitches: new Array(24).fill(0),
    physicalSwitches: new Array(24).fill(0),

    stationFeedback: new Array(6).fill(0),
    stationOnline: new Array(6).fill(false),
    stationLastSeen: new Array(6).fill(0)
};

// SYNC FIX: Track when we last took control to prevent race conditions
let lastControlTakeTime = 0;
let lastReleaseTime = 0;

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

    // SYNC LOGIC
    // SYNC LOGIC
    if (state.controller === 'CABANE') {
        state.virtualSwitches = [...state.physicalSwitches];

        // Auto-Correct Logic
        if (isOverrideActive) {
            // FIX: Only switch to SERVER if we haven't just released recently
            if (Date.now() - lastReleaseTime > 3000) {
                console.log("[SYNC] Main is in Override. Pi assuming SERVER Control.");
                state.controller = 'SERVER';
            }
        }
    }
    else {
        // If Pi is driving (USER/SERVER)

        // SAFETY CHECK: Did Main Controller force a reset?
        // We only check this if 3 seconds have passed since we took control.
        // This prevents the "Race Condition" where old packets trigger a release.
        if (!isOverrideActive && (Date.now() - lastControlTakeTime > 3000)) {
            console.log("[SYNC] Main Controller forced Manual Mode (Emergency).");
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
        pushUpdate();
    }
}

// --- ACTIONS ---

function takeControl(username) {
    state.controller = 'USER';
    state.currentUser = username;
    lastControlTakeTime = Date.now(); // Mark timestamp

    udpService.sendOverrideCommand(1);
    console.log(`[CONTROL] Taken by User: ${username}`);
    pushUpdate();
}

function releaseToServer() {
    state.controller = 'SERVER';
    state.currentUser = null;
    lastControlTakeTime = Date.now(); // Reset timestamp just in case

    udpService.sendOverrideCommand(1); // Re-assert override
    console.log(`[CONTROL] Released to SERVER`);
    pushUpdate();
}

function releaseToCabane() {
    state.controller = 'CABANE';
    state.currentUser = null;
    lastReleaseTime = Date.now(); // <--- MARK TIME

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

// --- CORE LOOPS ---

function controlLoop() {
    if (state.controller === 'USER' || state.controller === 'SERVER') {
        const stationBytes = new Array(6).fill(0);
        INPUT_MAP.forEach(m => {
            if (state.virtualSwitches[m.idx]) {
                stationBytes[m.st] |= (1 << m.bit);
            }
        });
        udpService.sendGlobalBroadcast(stationBytes);
    }
}

function checkHeartbeats() {
    const now = Date.now();
    if (state.mainControllerOnline && (now - state.lastMainHeartbeat > 5000)) {
        console.log("[ALARM] Main Controller LOST! Switching to SERVER Mode.");
        state.mainControllerOnline = false;
        if (state.controller === 'CABANE') {
            takeControl('SYSTEM_FAILSAFE');
        }
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