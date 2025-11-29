const dgram = require('dgram');
const { EventEmitter } = require('events');

class UdpService extends EventEmitter {
    constructor(io, db) {
        super();
        this.io = io; // Socket.io instance for frontend updates
        this.db = db; // Database connection

        this.socket = dgram.createSocket('udp4');
        this.port = 8888;

        // --- SYSTEM STATE ---
        this.mainControllerIP = '192.168.1.1'; // Default, updates dynamically if needed
        this.isMainControllerOnline = false;
        this.lastHeartbeat = 0;

        // Remote Override Mode
        this.overrideActive = false;
        this.overrideUser = null;

        // Station Data [Station ID] -> { ip, lastSeen, feedbackBits }
        this.stations = {};

        // Current System State (Virtual Switch Positions)
        // Array of 24 booleans (False = OFF, True = ON)
        // Matches the stableState[] array in Arduino
        this.virtualSwitches = new Array(24).fill(false);

        // --- BINDING EVENTS ---
        this.socket.on('message', (msg, rinfo) => this.handlePacket(msg, rinfo));
        this.socket.on('error', (err) => console.error(`[UDP] Error: ${err.message}`));
        this.socket.on('listening', () => console.log(`[UDP] Service listening on 0.0.0.0:${this.port}`));

        this.socket.bind(this.port);

        // Heartbeat Watchdog (Check every 1s)
        setInterval(() => this.checkMainControllerStatus(), 1000);
    }

    // 📥 PACKET PARSER
    handlePacket(msg, rinfo) {
        const hex = msg.toString('hex').toUpperCase();
        const header = msg[0];

        // 1. Heartbeat/Feedback from MAIN CONTROLLER
        // (Main controller sends commands to stations, but we might spy on them if we sniff)
        // For now, let's assume the Main Controller sends us a specific "Status Dump" packet 
        // OR we just listen to the Station -> Main traffic if we are in promiscuous mode (unlikely on switch).
        // 
        // BETTER APPROACH: We rely on Stations sending Heartbeats to us IF we are the Master.
        // But currently, Stations talk to 192.168.1.1.

        // Station -> Server Feedback (0xAC)
        // Note: Stations broadcast or send to specific IP. 
        if (header === 0xAC && msg.length >= 5) {
            const id = msg[1];
            const bits = msg[2];

            // Update internal state
            this.stations[id] = {
                ip: rinfo.address,
                lastSeen: Date.now(),
                feedback: bits
            };

            // Broadcast to Web Frontend
            this.io.emit('station_update', { id, bits, ip: rinfo.address });

            // Log logic if needed...
        }

        // Heartbeat (0xAB)
        else if (header === 0xAB && msg.length >= 4) {
            const id = msg[1];
            this.stations[id] = { ...this.stations[id], lastSeen: Date.now(), ip: rinfo.address };
            this.io.emit('station_heartbeat', { id, online: true });
        }

        // Special Packet: Main Controller Alive (0xAD Ping or Custom)
        // We need to implement a 'I am Alive' packet from the Mega to the Pi later.
        if (rinfo.address === this.mainControllerIP) {
            this.isMainControllerOnline = true;
            this.lastHeartbeat = Date.now();
        }
    }

    // 📤 COMMAND SENDER
    sendPacket(ip, buffer) {
        this.socket.send(buffer, this.port, ip, (err) => {
            if (err) console.error(`[UDP Tx] Fail to ${ip}:`, err);
        });
    }

    // 🎮 TAKE CONTROL (Override)
    enableOverride(username) {
        console.log(`[SYS] Override Enabled by ${username}`);
        this.overrideActive = true;
        this.overrideUser = username;

        // Send Override Command to Main Controller
        // Packet: [0xAF, 0x01 (Enable), Checksum]
        const pkt = Buffer.from([0xAF, 0x01, 0xAF ^ 0x01]);
        this.sendPacket(this.mainControllerIP, pkt);

        // Log to DB
        this.db.run("INSERT INTO logs (type, message, metadata) VALUES (?, ?, ?)",
            ['CONTROL', 'Override Enabled', username]);

        return true;
    }

    // 🏳️ RELEASE CONTROL
    disableOverride() {
        console.log(`[SYS] Override Released`);
        this.overrideActive = false;
        this.overrideUser = null;

        // Send Release Command
        // Packet: [0xAF, 0x00 (Disable), Checksum]
        const pkt = Buffer.from([0xAF, 0x00, 0xAF ^ 0x00]);
        this.sendPacket(this.mainControllerIP, pkt);

        this.db.run("INSERT INTO logs (type, message) VALUES (?, ?)",
            ['CONTROL', 'Override Released']);
    }

    // 🎛️ UPDATE VIRTUAL SWITCH (From Web UI)
    setSwitch(index, state) {
        if (!this.overrideActive && this.isMainControllerOnline) return false;

        // Update local state
        this.virtualSwitches[index] = state;

        // Send NEW STATE to Main Controller
        // Packet: [0xB0, Byte0, Byte1, Byte2, Checksum]
        // We pack 24 bools into 3 bytes
        const bytes = this.packSwitches(this.virtualSwitches);
        const checksum = 0xB0 ^ bytes[0] ^ bytes[1] ^ bytes[2];
        const pkt = Buffer.from([0xB0, bytes[0], bytes[1], bytes[2], checksum]);

        this.sendPacket(this.mainControllerIP, pkt);

        // If Main Controller is DEAD (Redundancy Mode), we must talk to Stations directly here.
        if (!this.isMainControllerOnline) {
            this.processLogicAndSendToStations();
        }

        return true;
    }

    // Helper: Pack bool array into bytes
    packSwitches(arr) {
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < 8; i++) if (arr[i]) b0 |= (1 << i);
        for (let i = 8; i < 16; i++) if (arr[i]) b1 |= (1 << (i - 8));
        for (let i = 16; i < 24; i++) if (arr[i]) b2 |= (1 << (i - 16));
        return [b0, b1, b2];
    }

    // 🩺 WATCHDOG
    checkMainControllerStatus() {
        const now = Date.now();
        const wasOnline = this.isMainControllerOnline;

        if (now - this.lastHeartbeat > 5000) {
            this.isMainControllerOnline = false;
        }

        if (wasOnline && !this.isMainControllerOnline) {
            console.warn("[SYS] CRITICAL: Main Controller LOST. Entering Headless Mode.");
            this.io.emit('system_alert', { type: 'controller_lost' });
        }
    }

    // 🧠 HEADLESS LOGIC (The Backup Brain)
    // This replicates the "sendAllStations" logic from the Arduino
    processLogicAndSendToStations() {
        // We need to define the Station Maps here in JS
        // Simplified example for Station 1 (Switches 0,1,4,5,6,7)
        // ... (We will populate this in the next step based on your Manual)
    }
}

module.exports = UdpService;