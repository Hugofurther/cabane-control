// ============================================================
// 📡 UDP SERVICE (Network Bridge) - FIXED v5
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
        console.error(`[UDP] Error:\n${err.stack}`);
        socket.close();
    });

    socket.on('message', (msg, rinfo) => {
        parsePacket(msg, rinfo);
    });

    socket.on('listening', () => {
        socket.setBroadcast(true); // Enable Broadcasting
        const address = socket.address();
        console.log(`[UDP] Listening on ${address.address}:${address.port}`);
    });

    socket.bind(PORT);
}

// --- PACKET PARSER (Incoming) ---
function parsePacket(msg, rinfo) {
    if (msg.length < 3) return;

    const header = msg[0];

    // 0xAC: STATION FEEDBACK (Broadcast)
    if (header === 0xAC && msg.length >= 4) {
        const id = msg[1];
        const bits = msg[2];
        logicEngine.updateStationFeedback(id, bits);
    }

    // 0xB1: MAIN CONTROLLER PHYSICAL STATE (Broadcast)
    else if (header === 0xB1 && msg.length >= 7) {
        const switchBytes = [msg[2], msg[3], msg[4]];
        const isOverrideActive = (msg[5] === 0x01);
        logicEngine.updatePhysicalState(switchBytes, isOverrideActive);
    }
}

// --- SENDING METHODS (Outgoing) ---

function xorChecksum(buf) {
    let c = 0;
    for (let i = 0; i < buf.length; i++) c ^= buf[i];
    return c;
}

// 🌍 SEND GLOBAL SYNC (0xBB) -> Broadcast
function sendGlobalBroadcast(stationBytesArray) {
    const packet = Buffer.alloc(10);
    packet[0] = 0xBB;
    packet[1] = 0x00; // Seq
    packet[2] = 0x02; // Master ID = 2 (Pi)

    for (let i = 0; i < 6; i++) {
        packet[3 + i] = stationBytesArray[i] || 0;
    }

    packet[9] = xorChecksum(packet.slice(0, 9));

    socket.send(packet, PORT, BROADCAST_IP, (err) => {
        if (err) console.error("[UDP] Global Send Error:", err);
    });
}

// 🕹️ SEND OVERRIDE COMMAND (0xAF) -> Unicast to Main
function sendOverrideCommand(mode) {
    const packet = Buffer.alloc(3);
    packet[0] = 0xAF;
    packet[1] = mode ? 0x01 : 0x00;
    packet[2] = packet[0] ^ packet[1];

    socket.send(packet, PORT, MAIN_CONTROLLER_IP, (err) => {
        if (err) console.error(`[UDP] Override Send Error:`, err);
    });
}

// 💡 SEND REMOTE DATA (0xB0) -> Unicast to Main
// This is the missing function causing your crash!
function sendRemoteData(switchBytes) {
    const packet = Buffer.alloc(5);
    packet[0] = 0xB0;
    packet[1] = switchBytes[0];
    packet[2] = switchBytes[1];
    packet[3] = switchBytes[2];
    packet[4] = xorChecksum(packet.slice(0, 4));

    socket.send(packet, PORT, MAIN_CONTROLLER_IP, (err) => {
        if (err) console.error("[UDP] Remote Data Send Error:", err);
    });
}

// ✅ EXPORT ALL FUNCTIONS
module.exports = {
    init,
    sendGlobalBroadcast,
    sendOverrideCommand,
    sendRemoteData
};