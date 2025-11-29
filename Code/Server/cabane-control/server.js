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

// --- Configuration ---
const PORT = process.env.PORT || 3000;

// --- Express App ---
const app = express();
app.use(cors());
app.use(express.json());

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

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`🌲 CABANE SERVER RUNNING ON PORT ${PORT}`);
    console.log(`=========================================\n`);
});