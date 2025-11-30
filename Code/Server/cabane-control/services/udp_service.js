// ============================================================
// 📡 UDP SERVICE (Network Bridge) - v4 GLOBAL SYNC
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
    // [AC] [ID] [Bits] [Cks]
    if (header === 0xAC && msg.length >= 4) { // Updated to 4 bytes
        const id = msg[1];
        const bits = msg[2];
        logicEngine.updateStationFeedback(id, bits);
    }

    // 0xB1: MAIN CONTROLLER PHYSICAL STATE (Broadcast)
    // [B1] [ID] [Sw0] [Sw1] [Sw2] [Flag] [Cks]
    else if (header === 0xB1 && msg.length >= 7) {
        const switchBytes = [msg[2], msg[3], msg[4]]; // Bytes 2,3,4
        const isOverrideActive = (msg[5] === 0x01);   // Byte 5
        logicEngine.updatePhysicalState(switchBytes, isOverrideActive);
    }
}

// --- SENDING METHODS (Outgoing) ---

function xorChecksum(buf) {
    let c = 0;
    for (let i = 0; i < buf.length; i++) c ^= buf[i];
    return c;
}

// 🌍 SEND GLOBAL SYNC (0xBB)
// Sends the "Train" packet to everyone (Stations + Main)
function sendGlobalBroadcast(stationBytesArray) {
    // Packet Structure (10 Bytes):
    // [BB] [Seq] [MasterID] [ST0] [ST1] [ST2] [ST3] [ST4] [ST5] [Cks]

    const packet = Buffer.alloc(10);
    packet[0] = 0xBB;
    packet[1] = 0x00; // Seq (Optional)
    packet[2] = 0x02; // Master ID = 2 (Pi Server)

    // Fill Station Bytes (Indices 3 to 8)
    for (let i = 0; i < 6; i++) {
        packet[3 + i] = stationBytesArray[i] || 0;
    }

    // Checksum (Index 9)
    packet[9] = xorChecksum(packet.slice(0, 9));

    // Send to 192.168.1.255
    socket.send(packet, PORT, BROADCAST_IP, (err) => {
        if (err) console.error("[UDP] Global Send Error:", err);
    });
}

// 🕹️ SEND OVERRIDE COMMAND (0xAF)
// Unicast to Main Controller (Reliability preference)
function sendOverrideCommand(mode) {
    const packet = Buffer.alloc(3);
    packet[0] = 0xAF;
    packet[1] = mode ? 0x01 : 0x00;
    packet[2] = packet[0] ^ packet[1];

    socket.send(packet, PORT, MAIN_CONTROLLER_IP, (err) => {
        if (err) console.error(`[UDP] Override Send Error:`, err);
        else console.log(`[UDP] Sent Override: ${mode ? 'TAKE' : 'RELEASE'}`);
    });
}

module.exports = {
    init,
    sendGlobalBroadcast,
    sendOverrideCommand
};