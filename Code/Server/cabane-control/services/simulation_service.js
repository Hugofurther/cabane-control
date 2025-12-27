// ============================================================
// 🎮 SIMULATION SERVICE - TOTALLY ISOLATED (v24 - Inversion Support)
// ============================================================
const dgram = require('dgram');
const db = require('../db');

let ioRef = null;
let active = false;
let owner = null;
let heartbeatInterval = null;

let extraState = 0;

// ✅ NEW: Inversion Mask
let switchMask = 0;

let config = Array(6).fill(null).map((_, i) => ({
    id: i,
    relays: Array(6).fill(null).map((__, r) => ({
        name: `Device ${r + 1}`,
        linked: true, enabled: true, targetSt: i, targetBit: r < 7 ? r : 0
    })),
    inputs: Array(7).fill(null).map((__, b) => ({ name: `Input ${b + 1}` }))
}));

let state = Array(6).fill(null).map((_, i) => ({
    id: i,
    connected: true,
    relayMask: 0,
    manualInputs: 0x7F,
    inputMask: 0x7F
}));

const THERMOSTATS = [
    { swIdx: 22, feedbackSt: 0, feedbackBit: 3, overrides: [2, 9, 14] },
    { swIdx: 23, feedbackSt: 4, feedbackBit: 3, overrides: [17] }
];

const INPUT_MAP = [
    { idx: 0, st: 1, bit: 0 }, { idx: 1, st: 1, bit: 1 }, { idx: 2, st: 0, bit: 0 }, { idx: 3, st: 0, bit: 1 },
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
                    } catch (e) { }
                }
                // ✅ Load Mask
                if (r.key === 'switch_logic_mask') switchMask = parseInt(r.value) || 0;
            });
        }
    });
}

function saveConfig() {
    const json = JSON.stringify(config);
    db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", ['simulation_config', json]);
}

// ✅ NEW: Update mask when Admin Panel saves
function updateSwitchMask(mask) {
    switchMask = mask;
    if (active) calculatePhysics();
}

function setSimulationActive(isActive, username) {
    active = isActive;
    owner = isActive ? username : null;
    if (active) {
        // Reset state
        state.forEach(s => { s.relayMask = 0; s.inputMask = 0x7F; });
        extraState = 0;
        if (!heartbeatInterval) heartbeatInterval = setInterval(heartbeatLoop, 1000);

        // Reload mask to be safe
        loadConfig();

        calculatePhysics();
    } else {
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    }
    emitStatus();
}

function getStatus() { return { active, owner, config, state, extraState }; }
function emitStatus() { if (ioRef) ioRef.emit('SIM_STATUS', getStatus()); }
function getOwner() { return owner; }

// --- ACTIONS ---

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

// ✅ TOGGLE LOGIC: Apply Inversion Here
function toggleSimSwitch(idx, value) {
    if (!active) return;

    // "value" is LOGICAL (from App). true = ON, false = OFF.
    // If Inverted, Logical ON means Physical OFF (0).

    let physicalValue = value ? 1 : 0;

    if ((switchMask >> idx) & 1) {
        // Inverted: Flip it
        physicalValue = physicalValue === 1 ? 0 : 1;
    }

    const map = INPUT_MAP.find(m => m.idx === idx);
    if (map) {
        if (physicalValue === 1) state[map.st].relayMask |= (1 << map.bit);
        else state[map.st].relayMask &= ~(1 << map.bit);
        emitStatus();
        setTimeout(calculatePhysics, 50);
    }
    else if (idx >= 21 && idx <= 23) {
        if (physicalValue === 1) extraState |= (1 << idx);
        else extraState &= ~(1 << idx);
        emitStatus();
        setTimeout(calculatePhysics, 50);
    }
}

// --- PHYSICS ENGINE ---

function calculatePhysics() {
    if (!active) return;
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

    let relayChanged = false;
    THERMOSTATS.forEach(th => {
        const isEnabled = (extraState >> th.swIdx) & 1;
        if (isEnabled) {
            const currentInputs = state[th.feedbackSt].inputMask;
            const rawBit = (currentInputs >> th.feedbackBit) & 1;
            if (rawBit === 0) {
                th.overrides.forEach(targetIdx => {
                    const map = INPUT_MAP.find(m => m.idx === targetIdx);
                    if (map) {
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
        resolveInputs();
    }

    for (let i = 0; i < 6; i++) {
        if (state[i].connected) sendFeedback(i);
    }
}

function sendFeedback(id) {
    if (!state[id].connected) return;
    if (ioRef) ioRef.emit('SIM_UPDATE', { id, ...state[id] });
}

function heartbeatLoop() {
    if (!active) return;
    for (let i = 0; i < 6; i++) { if (state[i].connected) { } }
}

module.exports = {
    init, setSimulationActive, getOwner, getStatus,
    updateRelayConfig, updateInputConfig, setName: updateInputConfig,
    toggleStationConnection, toggleManualInput, toggleSimSwitch, updateSwitchMask // ✅ Exported
};