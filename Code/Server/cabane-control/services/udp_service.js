// ============================================================
// 📡 UDP SERVICE (Network Bridge) - PRODUCTION v13 (Switch Logic)
// ============================================================
const dgram = require('dgram');

const socketCmd = dgram.createSocket('udp4'); // 8888
const socketFb = dgram.createSocket('udp4');  // 8889

const PORT_CMD = 8888;
const PORT_FB = 8889;
const MAIN_CONTROLLER_IP = '192.168.1.220';
const BROADCAST_IP = '192.168.1.255';

let logicEngine = null;

function init(engineRef) {
    logicEngine = engineRef;
    setupSocket(socketCmd, PORT_CMD, 'CMD');
    setupSocket(socketFb, PORT_FB, 'FB');
}

function setupSocket(sock, port, label) {
    sock.on('error', (err) => {
        console.error(`[UDP-${label}] Error:\n${err.stack}`);
        try { sock.close(); } catch (e) { }
    });

    sock.on('message', (msg, rinfo) => {
        try { parsePacket(msg, rinfo); } catch (e) { console.error(`[UDP-${label}] Parse Error:`, e.message); }
    });

    sock.on('listening', () => {
        sock.setBroadcast(true);
        const address = sock.address();
        console.log(`[UDP-${label}] Listening on ${address.address}:${address.port}`);
    });

    try { sock.bind(port, '0.0.0.0'); } catch (e) { console.error(`[UDP-${label}] Bind Error:`, e); }
}

function parsePacket(msg, rinfo) {
    if (msg.length < 3) return;
    const header = msg[0];

    if (header === 0xAC && msg.length >= 4) {
        if (logicEngine) logicEngine.updateStationFeedback(msg[1], msg[2]);
    }
    else if (header === 0xAB && msg.length >= 2) {
        if (logicEngine) logicEngine.updateStationHeartbeat(msg[1]);
    }
    else if (header === 0xB1 && msg.length >= 7) {
        const switchBytes = [msg[2], msg[3], msg[4]];
        const isOverrideActive = (msg[5] === 0x01);
        if (logicEngine) logicEngine.updatePhysicalState(switchBytes, isOverrideActive);
    }
    else if (header === 0xAD && msg.length >= 3) {
        checkAndDenyConflict(msg[1]);
    }
}

function checkAndDenyConflict(id) {
    if (!logicEngine) return;
    const state = logicEngine.getFullState();
    if (state.stationOnline[id]) {
        const packet = Buffer.alloc(3);
        packet[0] = 0xAE; packet[1] = id; packet[2] = packet[0] ^ packet[1];
        safeSend(socketCmd, packet, BROADCAST_IP, PORT_CMD, "ConflictDeny");
    }
}

function xorChecksum(buf) {
    let c = 0; for (let i = 0; i < buf.length; i++) c ^= buf[i]; return c;
}

function safeSend(sock, packet, ip, port, label) {
    try {
        sock.send(packet, port, ip, (err) => {
            if (err && err.code !== 'ENETUNREACH') console.error(`[UDP] ${label} Send Error:`, err.code);
        });
    } catch (e) { console.error(`[UDP] ${label} Sync Error:`, e.message); }
}

function sendGlobalBroadcast(stationBytesArray) {
    const packet = Buffer.alloc(10);
    packet[0] = 0xBB; packet[1] = 0x00; packet[2] = 0x02;
    for (let i = 0; i < 6; i++) packet[3 + i] = stationBytesArray[i] || 0;
    packet[9] = xorChecksum(packet.slice(0, 9));
    safeSend(socketCmd, packet, BROADCAST_IP, PORT_CMD, "Global");
}

function sendOverrideCommand(mode) {
    const packet = Buffer.alloc(3);
    packet[0] = 0xAF; packet[1] = mode ? 0x01 : 0x00; packet[2] = packet[0] ^ packet[1];
    safeSend(socketCmd, packet, MAIN_CONTROLLER_IP, PORT_CMD, "Override");
}

function sendRemoteData(switchBytes) {
    const packet = Buffer.alloc(5);
    packet[0] = 0xB0; packet[1] = switchBytes[0]; packet[2] = switchBytes[1]; packet[3] = switchBytes[2];
    packet[4] = xorChecksum(packet.slice(0, 4));
    safeSend(socketCmd, packet, MAIN_CONTROLLER_IP, PORT_CMD, "RemoteData");
}

function sendConfigPacket(alarmOnSec, alarmOffSec, reminderMin, burglarStation, stationMask) {
    const packet = Buffer.alloc(7);
    packet[0] = 0xCF;
    packet[1] = Math.min(255, alarmOnSec); packet[2] = Math.min(255, alarmOffSec);
    packet[3] = Math.min(255, reminderMin); packet[4] = Math.min(255, burglarStation || 0);
    packet[5] = Math.min(255, stationMask || 0x3F);
    packet[6] = packet[0] ^ packet[1] ^ packet[2] ^ packet[3] ^ packet[4] ^ packet[5];
    safeSend(socketCmd, packet, MAIN_CONTROLLER_IP, PORT_CMD, "ConfigUpdate");
}

// ✅ NEW: 0xD0 Switch Logic Packet
function sendSwitchLogicPacket(mask) {
    const packet = Buffer.alloc(5);
    packet[0] = 0xD0;
    packet[1] = mask & 0xFF;         // Byte 0
    packet[2] = (mask >> 8) & 0xFF;  // Byte 1
    packet[3] = (mask >> 16) & 0xFF; // Byte 2
    packet[4] = packet[0] ^ packet[1] ^ packet[2] ^ packet[3]; // Checksum

    safeSend(socketCmd, packet, MAIN_CONTROLLER_IP, PORT_CMD, "SwitchLogic");
}

module.exports = {
    init, sendGlobalBroadcast, sendOverrideCommand, sendRemoteData, sendConfigPacket, sendSwitchLogicPacket,
    updateStationHeartbeat: (id) => logicEngine?.updateStationHeartbeat(id)
};