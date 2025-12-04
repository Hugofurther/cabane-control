// ============================================================
// 🌲 CABANE CONTROL SERVER (Entry Point)
// ============================================================
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose(); // For Cleanup Task

// Services
const udpService = require('./services/udp_service');
const logicEngine = require('./services/logic_engine');
const apiRoutes = require('./routes'); // Import Routes ONCE

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
// 1. Start Logic Engine (needs IO to emit updates)
logicEngine.init(io);

// 2. Start UDP Service (needs Logic Engine to pass data)
udpService.init(logicEngine);

// --- MIDDLEWARE ---
// Inject 'io' into every API request so routes can emit logs
app.use((req, res, next) => {
    req.io = io;
    next();
});

// --- ROUTING ---
// 1. API Routes
app.use('/api', apiRoutes);

// 2. Serve Static Frontend (React App)
app.use(express.static(path.join(__dirname, 'public')));

// 3. SPA Fallback (Handle React Routing)
// Any request not caught by API or Static Files gets index.html
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- ONLINE USER TRACKING ---
const onlineUsers = new Map(); // Maps socket.id -> username

// --- WEBSOCKETS ---
io.on('connection', (socket) => {
    console.log(`[WS] Client Connected: ${socket.id}`);

    // Send immediate full state
    socket.emit('STATE_FULL', logicEngine.getFullState());
    // Send current online list immediately
    socket.emit('ONLINE_USERS', Array.from(new Set(onlineUsers.values())));

    // 1. Handle User Identification
    socket.on('IDENTIFY', (username) => {
        if (username) {
            onlineUsers.set(socket.id, username);
            // Broadcast updated list to EVERYONE
            io.emit('ONLINE_USERS', Array.from(new Set(onlineUsers.values())));
        }
    });

    // 2. Handle Disconnect
    socket.on('disconnect', () => {
        console.log(`[WS] Client Disconnected: ${socket.id}`);
        if (onlineUsers.has(socket.id)) {
            onlineUsers.delete(socket.id);
            // Broadcast updated list
            io.emit('ONLINE_USERS', Array.from(new Set(onlineUsers.values())));
        }
    });
});

// --- BACKGROUND TASKS ---
// Auto-Cleanup: Delete unverified users older than 3 hours
const cleanupDb = new sqlite3.Database('./cabane.db');
setInterval(() => {
    console.log("[CLEANUP] Checking for expired accounts...");
    const sql = `DELETE FROM users WHERE status = 'UNVERIFIED' AND created_at < datetime('now', '-3 hours')`;
    cleanupDb.run(sql, function (err) {
        if (err) console.error("[CLEANUP] Error:", err);
        else if (this.changes > 0) console.log(`[CLEANUP] Removed ${this.changes} expired users.`);
    });
}, 3600000); // Run every 1 hour

// --- START SERVER ---
server.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`🌲 CABANE SERVER RUNNING ON PORT ${PORT}`);
    console.log(`=========================================\n`);
});