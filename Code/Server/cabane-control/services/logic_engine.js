// ============================================================
// 🧠 LOGIC ENGINE (State Machine)
// ============================================================

// State Storage
const state = {
    // Who is driving? 'CABANE' or 'USER'
    controller: 'CABANE',
    currentUser: null,

    // Connectivity
    mainControllerOnline: false,
    lastMainHeartbeat: 0,

    // Switches (24 bools)
    virtualSwitches: new Array(24).fill(false), // App state
    physicalSwitches: new Array(24).fill(false), // Real switches on Mega

    // Station Feedback (6 Stations, 8 bits each)
    stationFeedback: new Array(6).fill(0),
    stationOnline: new Array(6).fill(false),
    stationLastSeen: new Array(6).fill(0)
};

let ioRef = null; // Reference to Socket.io

// --- Public Methods ---

function init(io) {
    ioRef = io;

    // Start Heartbeat Monitor Loop (Check every 1s)
    setInterval(checkHeartbeats, 1000);
}

function getFullState() {
    return state;
}

// Called when Main Controller sends 0xB1 (Physical State)
function updatePhysicalState(switchBytes) {
    state.mainControllerOnline = true;
    state.lastMainHeartbeat = Date.now();

    // Unpack bytes to bool array
    for (let i = 0; i < 24; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = i % 8;
        state.physicalSwitches[i] = (switchBytes[byteIdx] >> bitIdx) & 1;
    }

    // If Cabane is in control, Virtual matches Physical (Sync)
    if (state.controller === 'CABANE') {
        state.virtualSwitches = [...state.physicalSwitches];
    }

    pushUpdate();
}

// Called when Station sends 0xAC (Feedback)
function updateStationFeedback(id, bits) {
    if (id >= 0 && id < 6) {
        state.stationFeedback[id] = bits;
        state.stationOnline[id] = true;
        state.stationLastSeen[id] = Date.now();
        pushUpdate();
    }
}

// --- Internal Logic ---

function checkHeartbeats() {
    const now = Date.now();

    // 1. Check Main Controller
    if (now - state.lastMainHeartbeat > 5000) {
        if (state.mainControllerOnline) {
            console.log("[ALARM] Main Controller LOST! Switching to Headless Mode.");
            state.mainControllerOnline = false;
            // Force takeover if Mega dies
            if (state.controller === 'CABANE') {
                state.controller = 'USER'; // Pi takes over logic
                state.currentUser = 'SYSTEM_FAILSAFE';
            }
            pushUpdate();
        }
    }

    // 2. Check Stations
    for (let i = 0; i < 6; i++) {
        if (state.stationOnline[i] && (now - state.stationLastSeen[i] > 3000)) {
            state.stationOnline[i] = false;
            state.stationFeedback[i] = 0; // Clear feedback
            pushUpdate();
        }
    }
}

function pushUpdate() {
    if (ioRef) ioRef.emit('STATE_UPDATE', state);
}

module.exports = {
    init,
    getFullState,
    updatePhysicalState,
    updateStationFeedback
};