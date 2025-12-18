// ============================================================
// 📡 UDP SERVICE (Network Bridge) - PRODUCTION v8
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

    try {
        socket.bind(PORT, '0.0.0.0');
    } catch (e) {
        console.error("[UDP] Bind Error:", e);
    }
}

// ✅ NEW: SERVER ARBITER LOGIC
// 0xAD: Conflict Check [AD] [ID] [Cks]
// Respond with 0xAE [AE] [ID] [0xFF] [Cks] if ID is taken
function checkAndDenyConflict(id) {
    if (!logicEngine) return;
    const state = logicEngine.getFullState();

    // If the requested ID is currently ONLINE (heartbeat valid), DENY IT.
    if (state.stationOnline[id]) {
        console.log(`[UDP] Conflict Detected for Station ${id}. Sending Denial.`);
        const packet = Buffer.alloc(3);
        packet[0] = 0xAE;
        packet[1] = id;
        packet[2] = packet[0] ^ packet[1]; // Simple Checksum for Denial
        safeSend(packet, BROADCAST_IP, PORT, "ConflictDeny");
    }
}

function parsePacket(msg, rinfo) {
    if (msg.length < 3) return;
    const header = msg[0];

    if (header === 0xAC && msg.length >= 4) {
        // ... (Feedback Logic)
    }
    else if (header === 0xB1 && msg.length >= 7) {
        // ... (Main Logic)
    }
    // ✅ ADD THIS HANDLER
    else if (header === 0xAD && msg.length >= 3) {
        checkAndDenyConflict(msg[1]);
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

function safeSend(packet, ip, port, label) {
    try {
        socket.send(packet, port, ip, (err) => {
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

// ✅ UPDATED: Format: [0xCF] [On] [Off] [Rem] [BurgSt] [StMask] [Cks]
// Added 'stationMask' as the 6th byte (index 5)
function sendConfigPacket(alarmOnSec, alarmOffSec, reminderMin, burglarStation, stationMask) {
    const packet = Buffer.alloc(7); // Increased to 7 bytes
    packet[0] = 0xCF;
    packet[1] = Math.min(255, alarmOnSec);
    packet[2] = Math.min(255, alarmOffSec);
    packet[3] = Math.min(255, reminderMin);
    packet[4] = Math.min(255, burglarStation || 0);
    packet[5] = Math.min(255, stationMask || 0x3F); // Default all enabled (111111 = 63 = 0x3F)
    packet[6] = packet[0] ^ packet[1] ^ packet[2] ^ packet[3] ^ packet[4] ^ packet[5];

    safeSend(packet, MAIN_CONTROLLER_IP, PORT, "ConfigUpdate");
}

module.exports = {
    init,
    sendGlobalBroadcast,
    sendOverrideCommand,
    sendRemoteData,
    sendConfigPacket
};