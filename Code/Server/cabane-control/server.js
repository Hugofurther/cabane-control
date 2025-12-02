// ============================================================
// 🌲 CABANE CONTROL SERVER (Entry Point)
// ============================================================
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const udpService = require('./services/udp_service');
const logicEngine = require('./services/logic_engine');
const path = require('path');

// --- Configuration ---
const PORT = process.env.PORT || 3000;

// --- Express App ---
const app = express();
const apiRoutes = require('./routes');
app.use(cors());
app.use(express.json());

app.use('/api', apiRoutes);

// --- SERVE FRONTEND (React App) ---
// 1. Serve static files (js, css, images) from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// 2. Handle React Routing (SPA Fallback)
// We use 'app.use' without a path to catch ALL remaining requests
// that weren't handled by the API or Static files above.
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- HTTP Server & WebSockets ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- Initialize Core Services ---
// Pass the socket instance to the Logic Engine so it can push updates to UI
logicEngine.init(io);
udpService.init(logicEngine);

// --- Socket.io Connection Handler ---
io.on('connection', (socket) => {
    console.log(`[WS] Client Connected: ${socket.id}`);

    // Send immediate state snapshot on connect
    socket.emit('STATE_FULL', logicEngine.getFullState());

    socket.on('disconnect', () => {
        console.log(`[WS] Client Disconnected: ${socket.id}`);
    });
});

// ============================================================
// 🧹 AUTO-CLEANUP TASK
// ============================================================
const sqlite3 = require('sqlite3').verbose();
const cleanupDb = new sqlite3.Database('./cabane.db');

// Run every 1 hour (3600000 ms)
setInterval(() => {
    console.log("[CLEANUP] Checking for expired unverified accounts...");

    // Delete users who are 'UNVERIFIED' and created > 3 hours ago
    // SQLite modifier: '-3 hours'
    const sql = `DELETE FROM users 
               WHERE status = 'UNVERIFIED' 
               AND created_at < datetime('now', '-3 hours')`;

    cleanupDb.run(sql, function (err) {
        if (err) console.error("[CLEANUP] Error:", err);
        else if (this.changes > 0) {
            console.log(`[CLEANUP] Removed ${this.changes} expired registration(s).`);
        }
    });
}, 3600000);

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`🌲 CABANE SERVER RUNNING ON PORT ${PORT}`);
    console.log(`=========================================\n`);
});