require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

// Import our new "Brain" service
const UdpService = require('./services/udpService');

// --- CONFIGURATION ---
const HTTP_PORT = 3000;
const UDP_PORT = 8888;
const MAIN_CONTROLLER_IP = '192.168.1.220'; // UPDATED: Main Controller is now .220

// --- INITIALIZE SERVICES ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } }); // Allow all connections
const db = new sqlite3.Database('./cabane.db');

// Middleware
app.use(cors());
app.use(express.json());

// Initialize the Logic Brain (UDP Bridge)
// This service automatically starts listening on Port 8888 upon creation
const udpService = new UdpService(io, db);

// =================================================================
// 1. HTTP API (REST Endpoints)
// =================================================================

// Simple Status Check
app.get('/', (req, res) => {
    res.send('Cabane Control Server is Running.');
});

// Login Endpoint (Placeholder for Phase 4)
app.post('/api/login', (req, res) => {
    // TODO: Add bcrypt check against DB
    res.json({ success: true, message: "Auth logic pending" });
});

// =================================================================
// 2. WEBSOCKETS (Real-time updates)
// =================================================================

io.on('connection', (socket) => {
    console.log(`[Web] Client Connected: ${socket.id}`);

    // Send initial state to the newly connected user
    socket.emit('init_state', {
        controller: udpService.overrideActive ? udpService.overrideUser : 'Cabane',
        switches: udpService.virtualSwitches,
        isMainOnline: udpService.isMainControllerOnline
    });

    socket.on('disconnect', () => {
        console.log(`[Web] Client Disconnected: ${socket.id}`);
    });

    // --- CONTROL COMMANDS ---

    // User requests to Take Control
    socket.on('request_control', (data) => {
        // data = { username: 'John', token: '...' }
        // TODO: Verify Token

        console.log(`[Web] Control Request from ${data.username}`);
        const success = udpService.enableOverride(data.username);

        if (success) {
            // Tell everyone who is in charge now
            io.emit('control_status', {
                controller: data.username,
                active: true
            });
        }
    });

    // User Releases Control
    socket.on('release_control', () => {
        console.log(`[Web] Control Released`);
        udpService.disableOverride();
        io.emit('control_status', {
            controller: 'Cabane',
            active: false
        });
    });

    // User Toggles a Switch
    socket.on('toggle_switch', (data) => {
        // data = { index: 0, state: true }
        console.log(`[Web] Switch ${data.index} -> ${data.state}`);

        // Send to hardware via UDP Service
        const applied = udpService.setSwitch(data.index, data.state);

        if (applied) {
            // Broadcast the change to all other web users so their screens update
            socket.broadcast.emit('switch_update', data);
        }
    });
});

// =================================================================
// START SERVER
// =================================================================
server.listen(HTTP_PORT, () => {
    console.log(`--- Cabane Server Online ---`);
    console.log(`> HTTP/API: http://localhost:${HTTP_PORT}`);
    console.log(`> UDP Service: Active on Port 8888`);
});