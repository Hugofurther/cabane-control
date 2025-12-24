// ============================================================
// 🌲 CABANE CONTROL SERVER (Entry Point)
// ============================================================
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

// Services
const udpService = require('./services/udp_service');
const logicEngine = require('./services/logic_engine');
const apiRoutes = require('./routes');
const weatherService = require('./services/weather_service');
const simulationService = require('./services/simulation_service'); // ✅ NEW IMPORT

// Configuration
const PORT = process.env.PORT || 3000;

// Express App
const app = express();
app.use(cors());
app.use(express.json());

// HTTP & WebSocket Server
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- INITIALIZE SERVICES ---
logicEngine.init(io);
udpService.init(logicEngine);
weatherService.init(io);
simulationService.init(io); // ✅ Ensure Init is called here too if needed, or just rely on module state

// --- MIDDLEWARE ---
app.use((req, res, next) => {
    req.io = io;
    next();
});

// --- ROUTING ---
app.use('/api', apiRoutes);
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- ONLINE USER TRACKING ---
const onlineUsers = new Map();

// --- WEBSOCKETS ---
io.on('connection', (socket) => {
    console.log(`[WS] Client Connected: ${socket.id}`);

    // Send immediate full state
    socket.emit('STATE_FULL', logicEngine.getFullState());
    socket.emit('ONLINE_USERS', Array.from(new Set(onlineUsers.values())));

    // ✅ FIX: Send Simulation Status immediately on connection
    socket.emit('SIM_STATUS', simulationService.getStatus());

    weatherService.sendCurrentTo(socket);

    // 1. Handle User Identification
    socket.on('IDENTIFY', (username) => {
        if (username) {
            onlineUsers.set(socket.id, username);
            io.emit('ONLINE_USERS', Array.from(new Set(onlineUsers.values())));
        }
    });

    // 2. Handle Disconnect
    socket.on('disconnect', () => {
        console.log(`[WS] Client Disconnected: ${socket.id}`);
        if (onlineUsers.has(socket.id)) {
            onlineUsers.delete(socket.id);
            io.emit('ONLINE_USERS', Array.from(new Set(onlineUsers.values())));
        }
    });
});

// --- BACKGROUND TASKS ---
const cleanupDb = new sqlite3.Database('./cabane.db');
setInterval(() => {
    console.log("[CLEANUP] Checking for expired accounts...");
    const sql = `DELETE FROM users WHERE status = 'UNVERIFIED' AND created_at < datetime('now', '-3 hours')`;
    cleanupDb.run(sql, function (err) {
        if (err) console.error("[CLEANUP] Error:", err);
        else if (this.changes > 0) console.log(`[CLEANUP] Removed ${this.changes} expired users.`);
    });
}, 3600000);

// --- START SERVER ---
server.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`🌲 CABANE SERVER RUNNING ON PORT ${PORT}`);
    console.log(`=========================================\n`);
});