// ============================================================
// 🧠 LOGIC ENGINE (The Brain)
// ============================================================
const udpService = require('./udp_service');

// --- STATE STORAGE ---
const state = {
    controller: 'CABANE', // 'CABANE' or 'USER'
    currentUser: null,

    // Connectivity
    mainControllerOnline: false,
    lastMainHeartbeat: 0,

    // Switch Arrays (24 bools)
    virtualSwitches: new Array(24).fill(0), // 0 or 1
    physicalSwitches: new Array(24).fill(0), // From Main Controller Broadcast

    // Feedback (Visuals)
    stationFeedback: new Array(6).fill(0),
    stationOnline: new Array(6).fill(false),
    stationLastSeen: new Array(6).fill(0)
};

let ioRef = null;

// --- INPUT MAPPING (Ported from C++) ---
// Maps a Switch Index (0-23) to a Station ID and Bit Index
const INPUT_MAP = [
    { idx: 0, st: 1, bit: 0 }, // Sw0 -> ST1 Transport 1
    { idx: 1, st: 1, bit: 1 }, // Sw1 -> ST1 Transport 2
    { idx: 2, st: 0, bit: 0 }, // Sw2 -> ST0 Vac 1
    { idx: 3, st: 0, bit: 1 }, // Sw3 -> ST0 Vac 2
    { idx: 4, st: 1, bit: 2 }, // Sw4 -> ST1 Vic T1
    { idx: 5, st: 1, bit: 3 }, // Sw5 -> ST1 Overture
    { idx: 6, st: 1, bit: 4 }, // Sw6 -> ST1 Vid T2
    { idx: 7, st: 1, bit: 5 }, // Sw7 -> ST1 Vid ST2->1

    { idx: 8, st: 2, bit: 0 },  // Sw8 -> ST2 Transp
    { idx: 9, st: 2, bit: 1 },  // Sw9 -> ST2 Vac
    { idx: 10, st: 2, bit: 2 }, // Sw10 -> ST2 Vid 1->2
    { idx: 11, st: 2, bit: 3 }, // Sw11 -> ST2 Vid 3->2

    { idx: 12, st: 3, bit: 0 }, // Sw12 -> ST3 Transp 1
    { idx: 13, st: 3, bit: 1 }, // Sw13 -> ST3 Transp 2
    { idx: 14, st: 3, bit: 2 }, // Sw14 -> ST3 Vac
    { idx: 15, st: 3, bit: 3 }, // Sw15 -> ST3 Vid 2->3

    { idx: 16, st: 4, bit: 0 }, // Sw16 -> ST4 Transp
    { idx: 17, st: 4, bit: 1 }, // Sw17 -> ST4 Vac
    { idx: 18, st: 4, bit: 2 }, // Sw18 -> ST4 Vid

    { idx: 19, st: 5, bit: 0 }, // Sw19 -> ST5 Transp
    { idx: 20, st: 5, bit: 1 }, // Sw20 -> ST5 Vid

    // 21 (Buzzer), 22 (TH1), 23 (TH2) are handled specially
];

// --- INITIALIZATION ---
function init(io) {
    ioRef = io;

    // 1. Heartbeat Monitor (1s) - Checks if hardware died
    setInterval(checkHeartbeats, 1000);

    // 2. Control Loop (100ms) - Drives the factory
    setInterval(controlLoop, 100);
}

function getFullState() { return state; }

// --- INCOMING DATA HANDLERS ---

// From 0xB1 Packet
function updatePhysicalState(switchBytes, isOverrideActive) {
    state.mainControllerOnline = true;
    state.lastMainHeartbeat = Date.now();

    // Unpack
    for (let i = 0; i < 24; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = i % 8;
        state.physicalSwitches[i] = (switchBytes[byteIdx] >> bitIdx) & 1;
    }

    // Sync Mode: If Cabane is Master, Virtual follows Physical
    if (state.controller === 'CABANE') {
        state.virtualSwitches = [...state.physicalSwitches];

        // Safety Check: If Main says "I am overridden" but Pi thinks "Cabane is Master",
        // force Pi to accept Master state (likely a reconnect/reboot sync).
        if (isOverrideActive) {
            console.log("[SYNC] Main is in Override, but Pi was Idle. Assuming Control.");
            state.controller = 'USER';
            state.currentUser = 'RECONNECTED_SESSION'; // Or handle better auth recovery
        }
    }
    else {
        // If Pi is Master (USER), check if Main Controller forced a reset (Emergency Button)
        if (!isOverrideActive) {
            console.log("[SYNC] Main Controller forced Manual Mode (Emergency Release).");
            releaseControl();
        }
    }

    pushUpdate();
}

// From 0xAC Packet
function updateStationFeedback(id, bits) {
    if (id >= 0 && id < 6) {
        state.stationFeedback[id] = bits;
        state.stationOnline[id] = true;
        state.stationLastSeen[id] = Date.now();
        pushUpdate();
    }
}

// --- CONTROL ACTIONS (API Calls) ---

function takeControl(username) {
    state.controller = 'USER';
    state.currentUser = username;

    // 1. Send Override Command to Main
    udpService.sendOverrideCommand(1); // 1 = Take

    // 2. Initial Data Dump (Sync virtual state immediately)
    sendVirtualStateToMain();

    console.log(`[CONTROL] Taken by ${username}`);
    pushUpdate();
}

function releaseControl() {
    state.controller = 'CABANE';
    state.currentUser = null;

    // 1. Send Release Command
    udpService.sendOverrideCommand(0); // 0 = Release

    console.log(`[CONTROL] Released to Cabane`);
    pushUpdate();
}

// API toggles a virtual switch
function toggleSwitch(idx, value) {
    if (idx < 0 || idx > 23) return;
    state.virtualSwitches[idx] = value ? 1 : 0;
    pushUpdate();
}

// --- INTERNAL LOOPS ---

function controlLoop() {
    // Only send commands if PI is the MASTER
    if (state.controller === 'USER') {

        // 1. Send Data to Main Controller (so its logic matches ours)
        sendVirtualStateToMain();

        // 2. Calculate & Send Station Commands
        // Only strictly necessary if Main Controller is Dead (Headless),
        // but beneficial to send always for redundancy.

        // Reset station accumulators
        const stationBits = new Array(6).fill(0);

        // Map switches to station bits
        INPUT_MAP.forEach(m => {
            if (state.virtualSwitches[m.idx]) {
                stationBits[m.st] |= (1 << m.bit);
            }
        });

        // TODO: Add Thermostat Logic here (Override bits if TH is active)
        // For now, we trust the manual switches.

        // Send to all online stations
        for (let i = 0; i < 6; i++) {
            // Optimization: only send if station is alive or we are in Headless Mode
            // Actually, UDP is fire-and-forget. Send always.
            udpService.sendStationCommand(i, stationBits[i]);
        }
    }
}

function sendVirtualStateToMain() {
    // Pack 24 bools into 3 bytes
    const bytes = [0, 0, 0];
    for (let i = 0; i < 24; i++) {
        if (state.virtualSwitches[i]) {
            bytes[Math.floor(i / 8)] |= (1 << (i % 8));
        }
    }
    udpService.sendRemoteData(bytes);
}

function checkHeartbeats() {
    const now = Date.now();

    // Check Main Controller
    if (state.mainControllerOnline && (now - state.lastMainHeartbeat > 5000)) {
        console.log("[ALARM] Main Controller LOST! Force-Switching to Pi Control.");
        state.mainControllerOnline = false;

        // Auto-Takeover for safety (Headless Mode)
        if (state.controller === 'CABANE') {
            takeControl('SYSTEM_FAILSAFE');
        }
        pushUpdate();
    }
}

function pushUpdate() {
    if (ioRef) ioRef.emit('STATE_UPDATE', state);
}

module.exports = {
    init,
    getFullState,
    updatePhysicalState,
    updateStationFeedback,
    takeControl,
    releaseControl,
    toggleSwitch
};