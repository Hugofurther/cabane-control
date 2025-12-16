// ============================================================
// 📡 UDP SERVICE (Network Bridge) - PRODUCTION v7 (Split Port)
// ============================================================
const dgram = require('dgram');

// ✅ TWO SOCKETS
const socketCmd = dgram.createSocket('udp4'); // 8888
const socketFb = dgram.createSocket('udp4');  // 8889

// --- Configuration ---
const PORT_CMD = 8888;
const PORT_FB = 8889;
const MAIN_CONTROLLER_IP = '192.168.1.220';
const BROADCAST_IP = '192.168.1.255';

let logicEngine = null;

function init(engineRef) {
    logicEngine = engineRef;

    // --- SOCKET 1: COMMAND CHANNEL (8888) ---
    // Listens for Main Controller Status (0xB1)
    socketCmd.on('error', (err) => console.error(`[UDP-CMD] Error:\n${err.stack}`));

    socketCmd.on('message', (msg, rinfo) => {
        try {
            if (msg.length >= 3 && msg[0] === 0xB1) {
                parsePacket(msg, rinfo);
            }
        } catch (e) { console.error("[UDP-CMD] Parse Error:", e.message); }
    });

    socketCmd.on('listening', () => {
        socketCmd.setBroadcast(true);
        console.log(`[UDP-CMD] Listening on 8888`);
    });

    // --- SOCKET 2: FEEDBACK CHANNEL (8889) ---
    // Listens for Station Feedback (0xAC)
    socketFb.on('error', (err) => console.error(`[UDP-FB] Error:\n${err.stack}`));

    socketFb.on('message', (msg, rinfo) => {
        try {
            if (msg.length >= 3 && msg[0] === 0xAC) {
                parsePacket(msg, rinfo);
            }
        } catch (e) { console.error("[UDP-FB] Parse Error:", e.message); }
    });

    socketFb.on('listening', () => {
        socketFb.setBroadcast(true);
        console.log(`[UDP-FB] Listening on 8889`);
    });

    // Bind both
    try {
        socketCmd.bind(PORT_CMD, '0.0.0.0');
        socketFb.bind(PORT_FB, '0.0.0.0');
    } catch (e) {
        console.error("[UDP] Bind Error:", e);
    }
}

// --- PACKET PARSER ---
function parsePacket(msg, rinfo) {
    if (msg.length < 3) return;
    const header = msg[0];

    // 0xAC: STATION FEEDBACK (Via Socket 8889)
    if (header === 0xAC && msg.length >= 4) {
        const id = msg[1];
        const bits = msg[2];
        if (logicEngine) logicEngine.updateStationFeedback(id, bits);
    }

    // 0xB1: MAIN CONTROLLER PHYSICAL STATE (Via Socket 8888)
    else if (header === 0xB1 && msg.length >= 7) {
        const switchBytes = [msg[2], msg[3], msg[4]];
        const isOverrideActive = (msg[5] === 0x01);
        if (logicEngine) logicEngine.updatePhysicalState(switchBytes, isOverrideActive);
    }
}

// --- SENDING METHODS (Outgoing via Socket 8888) ---

function xorChecksum(buf) {
    let c = 0;
    for (let i = 0; i < buf.length; i++) c ^= buf[i];
    return c;
}

// Helper to safely send
function safeSend(packet, ip, port, label) {
    try {
        // ALWAYS use socketCmd (8888) for sending commands
        socketCmd.send(packet, port, ip, (err) => {
            if (err && err.code !== 'ENETUNREACH') {
                console.error(`[UDP] ${label} Send Error:`, err.code);
            }
        });
    } catch (e) {
        console.error(`[UDP] ${label} Sync Error:`, e.message);
    }
}

function sendGlobalBroadcast(stationBytesArray) {
    const packet = Buffer.alloc(10);
    packet[0] = 0xBB;
    packet[1] = 0x00;
    packet[2] = 0x02;
    for (let i = 0; i < 6; i++) {
        packet[3 + i] = stationBytesArray[i] || 0;
    }
    packet[9] = xorChecksum(packet.slice(0, 9));
    safeSend(packet, BROADCAST_IP, PORT_CMD, "Global");
}

function sendOverrideCommand(mode) {
    const packet = Buffer.alloc(3);
    packet[0] = 0xAF;
    packet[1] = mode ? 0x01 : 0x00;
    packet[2] = packet[0] ^ packet[1];
    safeSend(packet, MAIN_CONTROLLER_IP, PORT_CMD, "Override");
}

function sendRemoteData(switchBytes) {
    const packet = Buffer.alloc(5);
    packet[0] = 0xB0;
    packet[1] = switchBytes[0];
    packet[2] = switchBytes[1];
    packet[3] = switchBytes[2];
    packet[4] = xorChecksum(packet.slice(0, 4));
    safeSend(packet, MAIN_CONTROLLER_IP, PORT_CMD, "RemoteData");
}

function sendConfigPacket(alarmOnSec, alarmOffSec, reminderMin, burglarStation) {
    const packet = Buffer.alloc(6);
    packet[0] = 0xCF;
    packet[1] = Math.min(255, alarmOnSec);
    packet[2] = Math.min(255, alarmOffSec);
    packet[3] = Math.min(255, reminderMin);
    packet[4] = Math.min(255, burglarStation || 0);
    packet[5] = packet[0] ^ packet[1] ^ packet[2] ^ packet[3] ^ packet[4];
    safeSend(packet, MAIN_CONTROLLER_IP, PORT_CMD, "ConfigUpdate");
}

module.exports = {
    init,
    sendGlobalBroadcast,
    sendOverrideCommand,
    sendRemoteData,
    sendConfigPacket
};