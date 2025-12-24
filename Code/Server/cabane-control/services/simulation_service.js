// ============================================================
// 🎮 SIMULATION SERVICE - TOTALLY ISOLATED (v23 - No UDP Leak)
// ============================================================
const dgram = require('dgram');
const db = require('../db');

// ✅ REMOVED: UDP Client Socket (Source of the leak)
// const client = dgram.createSocket('udp4');
// const TARGET_PORT = 8889;
// const TARGET_IP = '127.0.0.1';

let ioRef = null;
let active = false;
let owner = null;
let heartbeatInterval = null;

let extraState = 0; // Switches 21, 22, 23

// CONFIG
let config = Array(6).fill(null).map((_, i) => ({
    id: i,
    relays: Array(6).fill(null).map((__, r) => ({
        name: `Device ${r + 1}`,
        linked: true, enabled: true, targetSt: i, targetBit: r < 7 ? r : 0
    })),
    inputs: Array(7).fill(null).map((__, b) => ({ name: `Input ${b + 1}` }))
}));

// RUNTIME STATE
let state = Array(6).fill(null).map((_, i) => ({
    id: i,
    connected: true,
    relayMask: 0,
    manualInputs: 0x7F,
    inputMask: 0x7F
}));

// THERMOSTATS & MAP
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
    db.get("SELECT value FROM system_settings WHERE key = 'simulation_config'", (err, row) => {
        if (row && row.value) {
            try {
                const saved = JSON.parse(row.value);
                if (Array.isArray(saved) && saved.length === 6) config = saved;
            } catch (e) { console.error("[SIM] Config load failed", e); }
        }
    });
}

function saveConfig() {
    const json = JSON.stringify(config);
    db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", ['simulation_config', json]);
}

function setSimulationActive(isActive, username) {
    active = isActive;
    owner = isActive ? username : null;

    console.log(`[SIM] Simulation Mode: ${isActive ? 'ON' : 'OFF'} (Owner: ${owner})`);

    // Reset state on start
    if (active) {
        state.forEach(s => { s.relayMask = 0; s.inputMask = 0x7F; });
        extraState = 0;
        if (!heartbeatInterval) heartbeatInterval = setInterval(heartbeatLoop, 1000);
        calculatePhysics();
    } else {
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    }

    emitStatus();
}

function getStatus() { return { active, owner, config, state, extraState }; }
function emitStatus() { if (ioRef) ioRef.emit('SIM_STATUS', getStatus()); }
function getOwner() { return owner; }

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

function toggleSimSwitch(idx, value) {
    if (!active) return;

    const map = INPUT_MAP.find(m => m.idx === idx);
    if (map) {
        if (value) state[map.st].relayMask |= (1 << map.bit);
        else state[map.st].relayMask &= ~(1 << map.bit);
        emitStatus();
        setTimeout(calculatePhysics, 50);
    }
    else if (idx >= 21 && idx <= 23) {
        if (value) extraState |= (1 << idx);
        else extraState &= ~(1 << idx);
        emitStatus();
        setTimeout(calculatePhysics, 50);
    }
}

// --- PHYSICS ENGINE ---

function calculatePhysics() {
    if (!active) return;

    // Helper: Determine Inputs from Relays + Manual
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
    const s = state[id];

    // ✅ FIX: DO NOT send UDP packets. 
    // This prevents udp_service.js from picking them up and polluting the real logic_engine state.

    // const packet = Buffer.alloc(5);
    // packet[0] = 0xAC; packet[1] = id; packet[2] = s.inputMask; packet[3] = 0x00;
    // packet[4] = packet[0] ^ packet[1] ^ packet[2] ^ packet[3];
    // client.send(packet, TARGET_PORT, TARGET_IP, (err) => { });

    if (ioRef) ioRef.emit('SIM_UPDATE', { id, ...s });
}

function sendHeartbeat(id) {
    if (!state[id].connected) return;
    // ✅ FIX: No UDP Heartbeats either
    // const packet = Buffer.alloc(4);
    // packet[0] = 0xAB; packet[1] = id; packet[2] = 0x00; packet[3] = packet[0] ^ packet[1] ^ packet[2];
    // client.send(packet, TARGET_PORT, TARGET_IP);
}

function heartbeatLoop() {
    if (!active) return;
    // Still loop to trigger logic if needed, but sendFeedback handles the check
    for (let i = 0; i < 6; i++) {
        if (state[i].connected) {
            // We can emit 'SIM_HEARTBEAT' via socket if needed by frontend, 
            // but SIM_UPDATE usually carries enough info.
        }
    }
}

module.exports = {
    init, setSimulationActive, getOwner, getStatus,
    updateRelayConfig, updateInputConfig, setName: updateInputConfig,
    toggleStationConnection, toggleManualInput, toggleSimSwitch
};