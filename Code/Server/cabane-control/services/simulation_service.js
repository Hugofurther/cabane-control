// ============================================================
// 🎮 SIMULATION SERVICE - VIRTUAL STATIONS
// ============================================================
const dgram = require('dgram');
const client = dgram.createSocket('udp4');

const TARGET_PORT = 8889; // Send to Server's Feedback Port
const TARGET_IP = '127.0.0.1'; // Loopback

let active = false;

// 6 Virtual Stations
// auto: If true, feedback automatically matches relay state
// relays: The command received from logic engine (0=OFF, 1=ON)
// inputs: The simulated sensor state (0=ON/Running, 1=OFF/Stopped) - Matches Logic Engine expectation
let stations = Array(6).fill(null).map((_, i) => ({
    id: i,
    auto: true,
    relays: 0, // Bitmask of commanded relays
    inputs: 0xFF // Bitmask of sensors (Start as 1s = OFF)
}));

function setSimulationActive(isActive) {
    active = isActive;
    console.log(`[SIM] Simulation Mode: ${active ? 'ON' : 'OFF'}`);
}

function getStatus() {
    return { active, stations };
}

// Called by API to toggle manual inputs
function setInput(id, bitIndex, value) {
    if (id < 0 || id > 5) return;
    const st = stations[id];

    // Logic: 0 = ON (Grounded), 1 = OFF (Floating)
    if (value) {
        st.inputs &= ~(1 << bitIndex); // Clear bit -> 0 -> ON
    } else {
        st.inputs |= (1 << bitIndex);  // Set bit -> 1 -> OFF
    }

    // Disable auto for this station if manual intervention? 
    // Ideally, if auto is ON, it will overwrite this quickly.
    // For manual testing, user should toggle 'Auto' off in UI first.
    sendFeedback(id);
}

// Called by API to toggle Auto Mode
function setAuto(id, isAuto) {
    if (id < 0 || id > 5) return;
    stations[id].auto = isAuto;
    // If turning auto ON, sync immediately
    if (isAuto) updatePhysics(id);
}

// Hook called by LogicEngine whenever commands change
function onCommandReceived(stationBytes) {
    if (!active) return;

    for (let i = 0; i < 6; i++) {
        const cmd = stationBytes[i] || 0;

        // Check for change
        if (stations[i].relays !== cmd) {
            stations[i].relays = cmd;
            if (stations[i].auto) {
                // Simulate physical delay (e.g. relay click + pump spin up)
                setTimeout(() => updatePhysics(i), 200);
            }
        }
    }
}

function updatePhysics(id) {
    const st = stations[id];
    if (!st.auto) return;

    // In Auto Mode, Inputs mirror Relays
    // Logic: Relay 1 (ON) -> Input 0 (ON/Active Low)
    // So we need to INVERT the relay bits to get input bits

    // However, we must preserve bits that AREN'T relays (if any).
    // For simplicity in simulation:
    // Input = ~Relay (masked to 8 bits)

    st.inputs = (~st.relays) & 0xFF;
    sendFeedback(id);
}

// Send UDP Packet to Main Server (Port 8889)
// Packet: [0xAC] [ID] [Bits] [0x00] [Cks]
function sendFeedback(id) {
    const st = stations[id];
    const packet = Buffer.alloc(5);
    packet[0] = 0xAC;
    packet[1] = id;
    packet[2] = st.inputs;
    packet[3] = 0x00; // Reserved

    // Checksum
    packet[4] = packet[0] ^ packet[1] ^ packet[2] ^ packet[3];

    client.send(packet, TARGET_PORT, TARGET_IP, (err) => {
        if (err) console.error(`[SIM] UDP Send Error:`, err);
    });
}

module.exports = {
    setSimulationActive,
    getStatus,
    setInput,
    setAuto,
    onCommandReceived
};