// ============================================================
// 📡 UDP SERVICE (Network Bridge) - PRODUCTION v7
// ============================================================
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');

// --- Configuration ---
const PORT = 8888;
const MAIN_CONTROLLER_IP = '192.168.1.220';
const BROADCAST_IP = '192.168.1.255';

let logicEngine = null;

function init(engineRef) {
    logicEngine = engineRef;

    socket.on('error', (err) => {
        console.error(`[UDP] Socket Critical Error:\n${err.stack}`);
        try { socket.close(); } catch (e) { }
    });

    socket.on('message', (msg, rinfo) => {
        try {
            parsePacket(msg, rinfo);
        } catch (e) {
            console.error("[UDP] Packet Parse Error:", e.message);
        }
    });

    socket.on('listening', () => {
        socket.setBroadcast(true);
        const address = socket.address();
        console.log(`[UDP] Listening on ${address.address}:${address.port}`);
    });

    // Bind to all interfaces to ensure traffic capture
    try {
        socket.bind(PORT, '0.0.0.0');
    } catch (e) {
        console.error("[UDP] Bind Error:", e);
    }
}

// --- PACKET PARSER (Incoming) ---
function parsePacket(msg, rinfo) {
    if (msg.length < 3) return;

    const header = msg[0];

    // 0xAC: STATION FEEDBACK
    if (header === 0xAC && msg.length >= 4) {
        const id = msg[1];
        const bits = msg[2];
        if (logicEngine) logicEngine.updateStationFeedback(id, bits);
    }

    // 0xB1: MAIN CONTROLLER PHYSICAL STATE
    else if (header === 0xB1 && msg.length >= 7) {
        const switchBytes = [msg[2], msg[3], msg[4]];
        const isOverrideActive = (msg[5] === 0x01);
        if (logicEngine) logicEngine.updatePhysicalState(switchBytes, isOverrideActive);
    }
}

// --- SENDING METHODS (Outgoing) ---

function xorChecksum(buf) {
    let c = 0;
    for (let i = 0; i < buf.length; i++) c ^= buf[i];
    return c;
}

// Helper to safely send without crashing on ENETUNREACH
function safeSend(packet, ip, port, label) {
    try {
        socket.send(packet, port, ip, (err) => {
            if (err) {
                // Suppress ENETUNREACH logs during disconnects
                if (err.code !== 'ENETUNREACH') {
                    console.error(`[UDP] ${label} Send Error:`, err.code);
                }
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
    safeSend(packet, BROADCAST_IP, PORT, "Global");
}

function sendOverrideCommand(mode) {
    const packet = Buffer.alloc(3);
    packet[0] = 0xAF;
    packet[1] = mode ? 0x01 : 0x00;
    packet[2] = packet[0] ^ packet[1];

    safeSend(packet, MAIN_CONTROLLER_IP, PORT, "Override");
}

function sendRemoteData(switchBytes) {
    const packet = Buffer.alloc(5);
    packet[0] = 0xB0;
    packet[1] = switchBytes[0];
    packet[2] = switchBytes[1];
    packet[3] = switchBytes[2];
    packet[4] = xorChecksum(packet.slice(0, 4));

    safeSend(packet, MAIN_CONTROLLER_IP, PORT, "RemoteData");
}

// ✅ NEW: Send Config to Main
// Format: [0xCF] [OnSec] [OffSec] [RemMin] [Checksum]
function sendConfigPacket(alarmOnSec, alarmOffSec, reminderMin) {
    const packet = Buffer.alloc(5);
    packet[0] = 0xCF;
    packet[1] = Math.min(255, alarmOnSec);
    packet[2] = Math.min(255, alarmOffSec);
    packet[3] = Math.min(255, reminderMin);
    packet[4] = packet[0] ^ packet[1] ^ packet[2] ^ packet[3];

    safeSend(packet, MAIN_CONTROLLER_IP, PORT, "ConfigUpdate");
}

module.exports = {
    init,
    sendGlobalBroadcast,
    sendOverrideCommand,
    sendRemoteData,
    sendConfigPacket // ✅ Export
};