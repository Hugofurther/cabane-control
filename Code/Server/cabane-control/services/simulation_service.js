// ============================================================
// 🎮 SIMULATION SERVICE - VIRTUAL STATIONS (v5 - Stable)
// ============================================================
const dgram = require('dgram');
const db = require('../db');
const client = dgram.createSocket('udp4');

const TARGET_PORT = 8889;
const TARGET_IP = '127.0.0.1';

let ioRef = null;
let active = false; // Master simulation switch
let heartbeatInterval = null; // ✅ Loop handle

// CONFIG
let config = Array(6).fill(null).map((_, i) => ({
    id: i,
    relays: Array(6).fill(null).map((__, r) => ({
        name: `Device ${r + 1}`,
        linked: true,
        enabled: true, // ✅ NEW: Default Enabled
        targetSt: i,
        targetBit: r < 7 ? r : 0
    })),
    inputs: Array(7).fill(null).map((__, b) => ({
        name: `Input ${b + 1}`
    }))
}));

// RUNTIME STATE (Not Persisted)
let state = Array(6).fill(null).map((_, i) => ({
    id: i,
    connected: true, // Virtual cable connection
    relayMask: 0,
    inputMask: 0x7F // Start all 1 (OFF/Idle)
}));

function init(io) {
    ioRef = io;
    loadConfig();
    // ✅ NOTE: We do NOT start the interval here anymore.
    // It starts only when setSimulationActive(true) is called.
}

// --- PERSISTENCE ---
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

// --- API CONTROL ---
function setSimulationActive(isActive) {
    active = isActive;
    console.log(`[SIM] Simulation Mode: ${isActive ? 'ON' : 'OFF'}`);

    // Notify Logic Engine to block real traffic
    try {
        const logicEngine = require('./logic_engine');
        logicEngine.setSimulationMode(isActive);
    } catch (e) {
        console.error("[SIM] Failed to notify Logic Engine", e);
    }

    if (active) {
        // ✅ START LOOP
        if (!heartbeatInterval) heartbeatInterval = setInterval(heartbeatLoop, 1000);
        // Force initial calculation
        calculatePhysics();
    } else {
        // ✅ STOP LOOP (Cleanup)
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }

    // ✅ CRITICAL FIX: Emit FULL STATUS (getStatus) so frontend receives 'config'
    if (ioRef) ioRef.emit('SIM_STATUS', getStatus());
}

function getStatus() {
    return { active, config, state };
}

function toggleStationConnection(id) {
    if (!state[id]) return;
    state[id].connected = !state[id].connected;

    // Emit update immediately
    if (ioRef) ioRef.emit('SIM_UPDATE', { id, ...state[id] });

    // ✅ FIX: Send heartbeat immediately on connect to refresh UI status
    if (state[id].connected) sendHeartbeat(id);
}

function updateRelayConfig(stId, relayIdx, updates) {
    if (!config[stId]) return;
    Object.assign(config[stId].relays[relayIdx], updates);
    saveConfig();
    if (active) calculatePhysics();
}

function toggleManualInput(stId, inputIdx) {
    if (!active || !state[stId].connected) return;

    // Toggle bit
    const current = (state[stId].inputMask >> inputIdx) & 1;
    const newVal = current === 1 ? 0 : 1; // Flip

    if (newVal === 1) state[stId].inputMask |= (1 << inputIdx);
    else state[stId].inputMask &= ~(1 << inputIdx);

    sendFeedback(stId);
}

// --- CORE LOGIC ---

// Hook called by LogicEngine
function onCommandReceived(stationBytes) {
    if (!active) return;

    let changed = false;
    for (let i = 0; i < 6; i++) {
        if (!state[i].connected) continue;

        const cmd = stationBytes[i] || 0;
        const maskedCmd = cmd & 0x3F; // Relays D2-D7

        if (state[i].relayMask !== maskedCmd) {
            state[i].relayMask = maskedCmd;
            changed = true;
        }
    }

    if (changed) {
        // Broadcast update to UI immediately so switches animate in Sim Panel
        // ✅ FIX: Send full status to keep UI synced
        if (ioRef) ioRef.emit('SIM_STATUS', getStatus());
        // Simulate relay mechanics delay
        setTimeout(calculatePhysics, 100);
    }
}

function calculatePhysics() {
    if (!active) return;

    let nextInputs = Array(6).fill(0x7F);

    config.forEach((stConfig, sourceStId) => {
        if (!state[sourceStId].connected) return;

        const sourceRelays = state[sourceStId].relayMask;

        stConfig.relays.forEach((rConfig, rIdx) => {
            // ✅ CHECK ENABLED
            if (!rConfig.enabled) return;

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

    for (let i = 0; i < 6; i++) {
        if (!state[i].connected) continue;
        if (state[i].inputMask !== nextInputs[i]) {
            state[i].inputMask = nextInputs[i];
            sendFeedback(i);
        }
    }
}

// --- UDP SENDERS ---

function sendFeedback(id) {
    if (!state[id].connected) return;

    const s = state[id];
    const packet = Buffer.alloc(5);
    packet[0] = 0xAC;
    packet[1] = id;
    packet[2] = s.inputMask;
    packet[3] = 0x00;
    packet[4] = packet[0] ^ packet[1] ^ packet[2] ^ packet[3];

    client.send(packet, TARGET_PORT, TARGET_IP);

    // Emit to UI so Sim Panel inputs update
    if (ioRef) ioRef.emit('SIM_UPDATE', { id, ...state[id] });




}

function sendHeartbeat(id) {
    if (!state[id].connected) return;

    const packet = Buffer.alloc(4);
    packet[0] = 0xAB; // Heartbeat Header
    packet[1] = id;
    packet[2] = 0x00;
    packet[3] = packet[0] ^ packet[1] ^ packet[2];

    client.send(packet, TARGET_PORT, TARGET_IP);
}


function heartbeatLoop() {
    if (!active) return;
    for (let i = 0; i < 6; i++) {
        sendHeartbeat(i);
    }
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