// ============================================================
// 🎮 SIMULATION SERVICE - TOTALLY ISOLATED (v32 - Full)
// ============================================================
const dgram = require('dgram');
const db = require('../db');

// --- INTERNAL STATE ---
let ioRef = null;
let active = false;
let owner = null;
let heartbeatInterval = null;

// ✅ PHYSICAL LINK: Determines if Sim drives Real Hardware
let physicalLink = false;

// ✅ EXTRA STATE: Holds bits for Buzzer (21), TH1 (22), TH2 (23)
let extraState = 0;

// ✅ INVERSION MASKS: Loaded from DB to match Physical/App settings
let switchMask = 0;
let ledMask = 0;

// --- CONFIGURATION GENERATION ---
// Generates the default relay/input names and links
let config = Array(6).fill(null).map((_, i) => {
    let relays = Array(6).fill(null).map((__, r) => ({
        name: `Device ${r + 1}`,
        linked: true,
        enabled: true,
        targetSt: i,
        targetBit: r < 7 ? r : 0
    }));

    // ✅ ST4 CONFIG (Merged ST5)
    // We map the new virtual relays for ST5 onto ST4
    if (i === 4) {
        relays[0].name = "ST4 Transp";
        relays[1].name = "ST4 Vac";
        relays[2].name = "ST4 Vid";
        relays[3].enabled = false; // Unused bit
        // Merged ST5 Controls
        relays[4] = { name: "ST5 Transp", linked: true, enabled: true, targetSt: 4, targetBit: 4 };
        relays[5] = { name: "ST5 Vid", linked: true, enabled: true, targetSt: 4, targetBit: 5 };
    }

    // ✅ DISABLE ST5 (Hardware Removed)
    if (i === 5) {
        relays.forEach(r => r.enabled = false);
    }

    return {
        id: i,
        relays,
        inputs: Array(7).fill(null).map((__, b) => ({ name: `Input ${b + 1}` }))
    };
});

// --- INPUT MAPPING (Matches Logic Engine) ---
// Note: 'st' refers to the Station ID. 255 means Global/Virtual.
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
    // ✅ ST5 Merged into ST4
    { idx: 19, st: 4, bit: 4 }, { idx: 20, st: 4, bit: 5 },
    // ✅ Global Extras (Buzzer, Thermostats)
    { idx: 21, st: 255, bit: 0 }, { idx: 22, st: 255, bit: 0 }, { idx: 23, st: 255, bit: 0 }
];

const THERMOSTATS = [
    { swIdx: 22, feedbackSt: 0, feedbackBit: 3, overrides: [2, 9, 14] },
    { swIdx: 23, feedbackSt: 4, feedbackBit: 3, overrides: [17] }
];

// --- RUNTIME STATE ---
let state = Array(6).fill(null).map((_, i) => ({
    id: i,
    connected: true,
    relayMask: 0,
    manualInputs: 0x7F, // Default inputs High (Inactive)
    inputMask: 0x7F
}));

function init(io) {
    ioRef = io;
    loadConfig();
}

function loadConfig() {
    db.all("SELECT key, value FROM system_settings", (err, rows) => {
        if (rows) {
            rows.forEach(r => {
                if (r.key === 'simulation_config') {
                    try {
                        const saved = JSON.parse(r.value);
                        if (Array.isArray(saved) && saved.length === 6) config = saved;
                    } catch (e) {
                        console.error("[SIM] Config Parse Error", e);
                    }
                }
                if (r.key === 'switch_logic_mask') switchMask = parseInt(r.value) || 0;
                if (r.key === 'led_logic_mask') ledMask = parseInt(r.value) || 0;
            });
        }
    });
}

function saveConfig() {
    const json = JSON.stringify(config);
    db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", ['simulation_config', json]);
}

function updateSwitchMask(mask) {
    switchMask = mask;
    if (active) calculatePhysics();
}

function updateLedMask(mask) {
    ledMask = mask;
    if (active) calculatePhysics();
}

function setSimulationActive(isActive, username) {
    active = isActive;
    owner = isActive ? username : null;

    // Safety: If turning off, kill link
    if (!isActive) physicalLink = false;

    if (active) {
        // Reset state on start
        state.forEach(s => {
            s.relayMask = 0;
            s.inputMask = 0x7F;
        });
        extraState = 0;

        if (!heartbeatInterval) heartbeatInterval = setInterval(heartbeatLoop, 1000);

        // Ensure fresh config
        loadConfig();
        calculatePhysics();
    } else {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }
    emitStatus();
}

// ✅ PHYSICAL LINK TOGGLE
function togglePhysicalLink(shouldLink, requestUser) {
    if (!active) return;

    physicalLink = shouldLink;
    console.log(`[SIM] Physical Link: ${physicalLink ? 'CONNECTED' : 'DISCONNECTED'}`);

    try {
        const logicEngine = require('./logic_engine');
        if (physicalLink) {
            // Take Real Control
            logicEngine.takeControl(owner || 'SIM_ADMIN');
        } else {
            // If unwiring, release control if we hold it
            const engState = logicEngine.getFullState();
            if (engState.currentUser === owner || engState.currentUser === 'SIM_ADMIN') {
                logicEngine.releaseToCabane();
            }
        }
    } catch (e) { console.error(e); }

    emitStatus();
}

function forcePhysicalUnlink() {
    if (physicalLink) {
        physicalLink = false;
        emitStatus();
    }
}

function getStatus() {
    return { active, owner, config, state, extraState, physicalLink };
}

function emitStatus() {
    if (ioRef) ioRef.emit('SIM_STATUS', getStatus());
}

function getOwner() { return owner; }
function isPhysicalLinked() { return physicalLink; }

// --- API ACTIONS ---

function toggleStationConnection(id) {
    if (!state[id]) return;
    state[id].connected = !state[id].connected;
    if (ioRef) ioRef.emit('SIM_UPDATE', { id, ...state[id] });
}

function updateRelayConfig(stId, relayIdx, updates) {
    if (!config[stId]) return;
    Object.assign(config[stId].relays[relayIdx], updates);
    saveConfig();
    if (active) calculatePhysics();
}

function updateInputConfig(stId, inputIdx, updates) {
    if (!config[stId]) return;
    Object.assign(config[stId].inputs[inputIdx], updates);
    saveConfig();
}

function toggleManualInput(stId, inputIdx) {
    if (!active || !state[stId].connected) return;
    const current = (state[stId].manualInputs >> inputIdx) & 1;
    const newVal = current === 1 ? 0 : 1;

    if (newVal === 1) state[stId].manualInputs |= (1 << inputIdx);
    else state[stId].manualInputs &= ~(1 << inputIdx);

    calculatePhysics();
}

// ✅ TOGGLE SWITCH: Handles Inversion Logic
// This is used when the simulation is ISOLATED and the user clicks a switch in the app.
function toggleSimSwitch(idx, value) {
    if (!active) return;

    // "value" is LOGICAL (from App). true = ON, false = OFF.
    let physicalValue = value ? 1 : 0;

    // If Inverted, Logical ON means Physical OFF (0)
    if ((switchMask >> idx) & 1) {
        physicalValue = physicalValue === 1 ? 0 : 1;
    }

    const map = INPUT_MAP.find(m => m.idx === idx);

    // ✅ SAFE CHECK: Only update `state` if map points to a valid station (0-5)
    // Indices 21, 22, 23 map to st: 255, so this block skips them.
    if (map && map.st < 6) {
        if (physicalValue === 1) state[map.st].relayMask |= (1 << map.bit);
        else state[map.st].relayMask &= ~(1 << map.bit);

        emitStatus();
        setTimeout(calculatePhysics, 50);
    }
    // ✅ FALLBACK for Global Extras (Buzzer/Thermostats)
    else if (idx >= 21 && idx <= 23) {
        if (physicalValue === 1) extraState |= (1 << idx);
        else extraState &= ~(1 << idx);

        emitStatus();
        setTimeout(calculatePhysics, 50);
    }
}

// ✅ GLOBAL COMMAND HOOK
// Called by LogicEngine when broadcasting to Stations.
// Used when Physical Link is ACTIVE to update the simulator visuals.
function onCommandReceived(stationBytes) {
    if (!active) return;

    // If Isolated, we ignore external commands to prevent jitter/reverting
    if (!physicalLink) return;

    for (let i = 0; i < 6; i++) {
        const cmd = stationBytes[i] || 0;
        const maskedCmd = cmd & 0x3F; // Mask out config bits
        state[i].relayMask = maskedCmd;
    }
    emitStatus();
    setTimeout(calculatePhysics, 50);
}

// --- PHYSICS ENGINE ---

function calculatePhysics() {
    if (!active) return;

    // 1. Resolve Links (Relay -> Input)
    const resolveInputs = () => {
        let nextInputs = state.map(s => s.manualInputs);

        config.forEach((stConfig, sourceStId) => {
            if (!state[sourceStId].connected) return;
            const sourceRelays = state[sourceStId].relayMask;

            stConfig.relays.forEach((rConfig, rIdx) => {
                if (rConfig.enabled === false) return;

                const isRelayOn = (sourceRelays >> rIdx) & 1;

                if (isRelayOn && rConfig.linked) {
                    const tSt = rConfig.targetSt;
                    const tBit = rConfig.targetBit;

                    if (tSt >= 0 && tSt < 6 && tBit >= 0 && tBit < 7) {
                        // Pull Input Low (Active)
                        nextInputs[tSt] &= ~(1 << tBit);
                    }
                }
            });
        });

        let changed = false;
        for (let i = 0; i < 6; i++) {
            if (!state[i].connected) continue;
            if (state[i].inputMask !== nextInputs[i]) {
                state[i].inputMask = nextInputs[i];
                changed = true;
            }
        }
        return changed;
    };

    resolveInputs();

    // 2. Thermostat Logic (Virtual)
    // If Thermostat Switch is ON, and Temp Feedback is Cold (0),
    // override the mapped relays to ON.
    let relayChanged = false;
    THERMOSTATS.forEach(th => {
        // ✅ Check Extra State (Indices 22/23)
        const isEnabled = (extraState >> th.swIdx) & 1;

        if (isEnabled) {
            const currentInputs = state[th.feedbackSt].inputMask;
            let rawBit = (currentInputs >> th.feedbackBit) & 1;

            // ✅ APPLY LED INVERSION TO SIMULATED SENSOR
            // This ensures the virtual thermostat triggers based on the inverted sensor logic
            if ((ledMask >> th.swIdx) & 1) {
                rawBit = rawBit === 1 ? 0 : 1;
            }

            // Active Low Input (after inversion) = Call for heat
            if (rawBit === 0) {
                th.overrides.forEach(targetIdx => {
                    const map = INPUT_MAP.find(m => m.idx === targetIdx);
                    if (map && map.st < 6) {
                        if (!((state[map.st].relayMask >> map.bit) & 1)) {
                            state[map.st].relayMask |= (1 << map.bit);
                            relayChanged = true;
                        }
                    }
                });
            }
        }
    });

    if (relayChanged) {
        emitStatus();
        resolveInputs(); // Recalculate physics if relays changed
    }

    // 3. Send Feedback
    for (let i = 0; i < 6; i++) {
        if (state[i].connected) sendFeedback(i);
    }
}

function sendFeedback(id) {
    if (!state[id].connected) return;

    // ✅ NO UDP PACKET SENT (Isolated)
    // Only emit to Frontend via Socket.io to update the "Parallel Universe"
    if (ioRef) ioRef.emit('SIM_UPDATE', { id, ...state[id] });
}

function heartbeatLoop() {
    if (!active) return;
    // Loop to keep things alive if needed
}

module.exports = {
    init, setSimulationActive, getOwner, getStatus,
    updateRelayConfig, updateInputConfig, setName: updateInputConfig,
    toggleStationConnection, toggleManualInput, toggleSimSwitch,
    updateSwitchMask, updateLedMask,
    onCommandReceived, togglePhysicalLink, forcePhysicalUnlink, isPhysicalLinked
};