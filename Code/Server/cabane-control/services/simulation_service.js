// ============================================================
// 🎮 SIMULATION SERVICE - VIRTUAL STATIONS (v16 - System Switches)
// ============================================================
const dgram = require('dgram');
const db = require('../db');
const client = dgram.createSocket('udp4');

const TARGET_PORT = 8889;
const TARGET_IP = '127.0.0.1';

let ioRef = null;
let active = false;
let owner = null;
let heartbeatInterval = null;

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

// ✅ NEW: Track System Switches (21, 22, 23) separately
let systemSwitchMask = 0;

let physicalLink = false;

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

    if (!isActive && physicalLink) {
        togglePhysicalLink(false);
    }

    try {
        const logicEngine = require('./logic_engine');
        logicEngine.setSimulationMode(isActive);
    } catch (e) { console.error(e); }

    if (active) {
        if (!heartbeatInterval) heartbeatInterval = setInterval(heartbeatLoop, 1000);
        calculatePhysics();
        state.forEach((s, i) => { if (s.connected) { sendFeedback(i); sendHeartbeat(i); } });
    } else {
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    }

    emitStatus();
}

function togglePhysicalLink(shouldLink, requestUser) {
    if (!active) return;
    if (owner && requestUser && requestUser !== owner) return;

    physicalLink = shouldLink;
    console.log(`[SIM] Physical Link: ${physicalLink ? 'CONNECTED' : 'DISCONNECTED'}`);

    const logicEngine = require('./logic_engine');
    logicEngine.setPhysicalLink(physicalLink);

    if (physicalLink) {
        logicEngine.takeControl(owner || 'SIM_ADMIN');
    } else {
        const engState = logicEngine.getFullState();
        if (engState.currentUser === (owner || 'SIM_ADMIN')) {
            logicEngine.releaseToCabane();
        }
    }
    emitStatus();
}

function forcePhysicalUnlink() {
    if (physicalLink) {
        console.log("[SIM] Control Lost (Preempted). Disabling Physical Link.");
        physicalLink = false;
        try {
            const logicEngine = require('./logic_engine');
            logicEngine.setSimulationMode(true);
            logicEngine.setPhysicalLink(false);
        } catch (e) { }
        emitStatus();
    }
}

// ✅ INCLUDE systemSwitchMask in Status
function getStatus() { return { active, owner, config, state, physicalLink, systemSwitchMask }; }
function emitStatus() { if (ioRef) ioRef.emit('SIM_STATUS', getStatus()); }
function isPhysicalLinked() { return physicalLink; }
function getOwner() { return owner; }

// --- STATION COMMANDS ---

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

function updateInputConfig(stId, inputIdx, updates) {
    if (!config[stId]) return;
    Object.assign(config[stId].inputs[inputIdx], updates);
    saveConfig();
}

function setName(id, bit, name) { updateInputConfig(id, bit, { name }); }

function toggleManualInput(stId, inputIdx) {
    if (!active || !state[stId].connected) return;
    const current = (state[stId].manualInputs >> inputIdx) & 1;
    const newVal = current === 1 ? 0 : 1;
    if (newVal === 1) state[stId].manualInputs |= (1 << inputIdx);
    else state[stId].manualInputs &= ~(1 << inputIdx);
    calculatePhysics();
}

// --- CORE LOGIC ---

function setVirtualRelay(idx, value) {
    if (!active) return;

    // ✅ HANDLE SYSTEM SWITCHES (21, 22, 23)
    if (idx >= 21 && idx <= 23) {
        const bit = idx - 21; // 0, 1, 2
        if (value) systemSwitchMask |= (1 << bit);
        else systemSwitchMask &= ~(1 << bit);
        emitStatus();
        return;
    }

    const INPUT_MAP = [
        { idx: 0, st: 1, bit: 0 }, { idx: 1, st: 1, bit: 1 }, { idx: 2, st: 0, bit: 0 }, { idx: 3, st: 0, bit: 1 },
        { idx: 4, st: 1, bit: 2 }, { idx: 5, st: 1, bit: 3 }, { idx: 6, st: 1, bit: 4 }, { idx: 7, st: 1, bit: 5 },
        { idx: 8, st: 2, bit: 0 }, { idx: 9, st: 2, bit: 1 }, { idx: 10, st: 2, bit: 2 }, { idx: 11, st: 2, bit: 3 },
        { idx: 12, st: 3, bit: 0 }, { idx: 13, st: 3, bit: 1 }, { idx: 14, st: 3, bit: 2 }, { idx: 15, st: 3, bit: 3 },
        { idx: 16, st: 4, bit: 0 }, { idx: 17, st: 4, bit: 1 }, { idx: 18, st: 4, bit: 2 },
        { idx: 19, st: 5, bit: 0 }, { idx: 20, st: 5, bit: 1 }
    ];

    const map = INPUT_MAP.find(m => m.idx === idx);
    if (!map) return;

    if (value) state[map.st].relayMask |= (1 << map.bit);
    else state[map.st].relayMask &= ~(1 << map.bit);

    emitStatus();
    setTimeout(calculatePhysics, 100);
}

function onCommandReceived(stationBytes) {
    if (!active) return;
    if (!physicalLink) return;

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
        emitStatus();
        setTimeout(calculatePhysics, 100);
    }
}

function calculatePhysics() {
    if (!active) return;

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

    try {
        const logicEngine = require('./logic_engine');
        logicEngine.updateSimFeedback(id, s.inputMask);
    } catch (e) { }

    const packet = Buffer.alloc(5);
    packet[0] = 0xAC; packet[1] = id; packet[2] = s.inputMask; packet[3] = 0x00;
    packet[4] = packet[0] ^ packet[1] ^ packet[2] ^ packet[3];
    client.send(packet, TARGET_PORT, TARGET_IP, (err) => { if (err) console.error(`[SIM] UDP Error:`, err); });
    if (ioRef) ioRef.emit('SIM_UPDATE', { id, ...s });
}

function sendHeartbeat(id) {
    if (!state[id].connected) return;
    const packet = Buffer.alloc(4);
    packet[0] = 0xAB; packet[1] = id; packet[2] = 0x00; packet[3] = packet[0] ^ packet[1] ^ packet[2];
    client.send(packet, TARGET_PORT, TARGET_IP);
}

function heartbeatLoop() {
    if (!active) return;
    for (let i = 0; i < 6; i++) sendHeartbeat(i);
}

module.exports = {
    init, setSimulationActive, togglePhysicalLink, forcePhysicalUnlink, isPhysicalLinked, getOwner, getStatus, updateRelayConfig, updateInputConfig, setName, toggleStationConnection, toggleManualInput, onCommandReceived, setVirtualRelay
};