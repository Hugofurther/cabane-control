// ============================================================
// 📡 UDP SERVICE (Network Bridge) - SEND & RECEIVE
// ============================================================
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');

// --- Configuration ---
const PORT = 8888;
const MAIN_CONTROLLER_IP = '192.168.1.220'; // Target for Override Commands

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
    if (header === 0xAC && msg.length >= 5) {
        const id = msg[1];
        const bits = msg[2];
        logicEngine.updateStationFeedback(id, bits);
    }

    // 0xB1: MAIN CONTROLLER PHYSICAL STATE
    else if (header === 0xB1 && msg.length >= 7) {
        const switchBytes = [msg[1], msg[2], msg[3]];
        const isOverrideActive = (msg[4] === 0x01); // Byte 4 is override flag
        logicEngine.updatePhysicalState(switchBytes, isOverrideActive);
    }
}

// --- SENDING METHODS (Outgoing) ---

function xorChecksum(buf) {
    let c = 0;
    for (let i = 0; i < buf.length; i++) c ^= buf[i];
    return c;
}

// Send Command to a specific Station (e.g., 192.168.1.211)
// Used when Pi is in control (Headless or Override)
function sendStationCommand(stationId, bits) {
    // Target IP: 192.168.1.210 + ID
    const targetIp = `192.168.1.${210 + stationId}`;

    const packet = Buffer.alloc(5);
    packet[0] = 0xAA;
    packet[1] = stationId;
    packet[2] = 0x01; // Command: Set Bits
    packet[3] = bits;
    packet[4] = xorChecksum(packet.slice(0, 4));

    socket.send(packet, PORT, targetIp, (err) => {
        if (err) console.error(`[UDP] Send Error to ST${stationId}:`, err);
    });
}

// Send Override Flag to Main Controller
// mode: 1 = Take Control, 0 = Release Control
function sendOverrideCommand(mode) {
    const packet = Buffer.alloc(3);
    packet[0] = 0xAF;
    packet[1] = mode ? 0x01 : 0x00;
    packet[2] = packet[0] ^ packet[1]; // Checksum

    socket.send(packet, PORT, MAIN_CONTROLLER_IP, (err) => {
        if (err) console.error(`[UDP] Override Send Error:`, err);
        else console.log(`[UDP] Sent Override Command: ${mode ? 'TAKE' : 'RELEASE'}`);
    });
}

// Send Virtual Switch Data to Main Controller (0xB0)
// This lets the Main Controller know what the Pi wants, even if Main is executing.
function sendRemoteData(switchBytes) {
    const packet = Buffer.alloc(5);
    packet[0] = 0xB0;
    packet[1] = switchBytes[0];
    packet[2] = switchBytes[1];
    packet[3] = switchBytes[2];
    packet[4] = xorChecksum(packet.slice(0, 4));

    socket.send(packet, PORT, MAIN_CONTROLLER_IP);
}

module.exports = {
    init,
    sendStationCommand,
    sendOverrideCommand,
    sendRemoteData
};