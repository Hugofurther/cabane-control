// ============================================================
// 🎮 SIMULATION SERVICE - VIRTUAL STATIONS (v5.1 - Persistence Fix)
// ============================================================
const dgram = require('dgram');
const db = require('../db');
const client = dgram.createSocket('udp4');

const TARGET_PORT = 8889;
const TARGET_IP = '127.0.0.1';

let ioRef = null;
let active = false;
let heartbeatInterval = null;

// CONFIG (Persisted)
let config = Array(6).fill(null).map((_, i) => ({
    id: i,
    relays: Array(6).fill(null).map((__, r) => ({
        name: `Device ${r + 1}`,
        linked: true,
        enabled: true,
        targetSt: i,
        targetBit: r < 7 ? r : 0
    })),
    inputs: Array(7).fill(null).map((__, b) => ({
        name: `Input ${b + 1}`
    }))
}));

// RUNTIME STATE
let state = Array(6).fill(null).map((_, i) => ({
    id: i,
    connected: true,
    relayMask: 0,
    manualInputs: 0x7F, // ✅ NEW: Tracks manual toggles separately (1=OFF, 0=ON)
    inputMask: 0x7F     // Final calculated state
}));

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

function setSimulationActive(isActive) {
    active = isActive;
    console.log(`[SIM] Simulation Mode: ${isActive ? 'ON' : 'OFF'}`);

    try {
        const logicEngine = require('./logic_engine');
        logicEngine.setSimulationMode(isActive);
    } catch (e) { console.error(e); }

    if (active) {
        if (!heartbeatInterval) heartbeatInterval = setInterval(heartbeatLoop, 1000);
        calculatePhysics();
    } else {
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    }

    if (ioRef) ioRef.emit('SIM_STATUS', getStatus());
}

function getStatus() { return { active, config, state }; }

function toggleStationConnection(id) {
    if (!state[id]) return;
    state[id].connected = !state[id].connected;
    if (ioRef) ioRef.emit('SIM_UPDATE', { id, ...state[id] });
    if (state[id].connected) sendHeartbeat(id);
}

function updateRelayConfig(stId, relayIdx, updates) {
    if (!config[stId]) return;
    Object.assign(config[stId].relays[relayIdx], updates);
    saveConfig();
    if (active) calculatePhysics();
}

// ✅ UPDATED: Toggle the MANUAL state, then recalc physics
function toggleManualInput(stId, inputIdx) {
    if (!active || !state[stId].connected) return;

    // Toggle the bit in manualInputs (Active Low: 1=OFF, 0=ON)
    const current = (state[stId].manualInputs >> inputIdx) & 1;
    const newVal = current === 1 ? 0 : 1;

    if (newVal === 1) state[stId].manualInputs |= (1 << inputIdx); // Set to 1 (OFF)
    else state[stId].manualInputs &= ~(1 << inputIdx);             // Set to 0 (ON)

    // Trigger physics to merge Manual + Relay states
    calculatePhysics();
}

function onCommandReceived(stationBytes) {
    if (!active) return;
    let changed = false;
    for (let i = 0; i < 6; i++) {
        const cmd = stationBytes[i] || 0;
        const maskedCmd = cmd & 0x3F;
        if (state[i].relayMask !== maskedCmd) {
            state[i].relayMask = maskedCmd;
            changed = true;
        }
    }
    if (changed) {
        if (ioRef) ioRef.emit('SIM_STATUS', getStatus());
        setTimeout(calculatePhysics, 100);
    }
}

// ✅ UPDATED: Merge Manual + Relay Logic
function calculatePhysics() {
    if (!active) return;

    // 1. Start with the Manual State (Preserves unlinked switches)
    let nextInputs = state.map(s => s.manualInputs);

    // 2. Apply Relay Links (Active Relays pull inputs LOW/ON)
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
                    // Logic: Relay ON -> Input Active (0)
                    // We use Bitwise AND with ~Mask to clear the bit
                    nextInputs[tSt] &= ~(1 << tBit);
                }
            }
        });
    });

    // 3. Apply changes and Send Feedback
    for (let i = 0; i < 6; i++) {
        if (!state[i].connected) continue;

        if (state[i].inputMask !== nextInputs[i]) {
            state[i].inputMask = nextInputs[i];
            sendFeedback(i);
        }
    }
}

function sendFeedback(id) {
    if (!state[id].connected) return;
    const s = state[id];
    const packet = Buffer.alloc(5);
    packet[0] = 0xAC;
    packet[1] = id;
    packet[2] = s.inputMask;
    packet[3] = 0x00;
    packet[4] = packet[0] ^ packet[1] ^ packet[2] ^ packet[3];
    client.send(packet, TARGET_PORT, TARGET_IP, (err) => { if (err) console.error(`[SIM] UDP Error:`, err); });
    if (ioRef) ioRef.emit('SIM_UPDATE', { id, ...s });
}

function sendHeartbeat(id) {
    if (!state[id].connected) return;
    const packet = Buffer.alloc(4);
    packet[0] = 0xAB;
    packet[1] = id;
    packet[2] = 0x00;
    packet[3] = packet[0] ^ packet[1] ^ packet[2];
    client.send(packet, TARGET_PORT, TARGET_IP);
}

function heartbeatLoop() {
    if (!active) return;
    for (let i = 0; i < 6; i++) sendHeartbeat(i);
}

module.exports = {
    init,
    setSimulationActive,
    getStatus,
    updateRelayConfig,
    toggleStationConnection,
    toggleManualInput,
    onCommandReceived
};