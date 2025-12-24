const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth'); // ✅ No requireAdmin
const simulationService = require('../services/simulation_service');

// ============================================================
// 🎮 SIMULATION API ROUTES
// ============================================================

// 1. GET STATUS (Full Config + State)
router.get('/simulation/status', authenticateToken, (req, res) => {
    res.json(simulationService.getStatus());
});

// 2. TOGGLE SIMULATION (Master Switch) - ✅ Available to All Users
router.post('/simulation/toggle', authenticateToken, (req, res) => {
    const { active } = req.body;
    simulationService.setSimulationActive(active, req.user.username); // ✅ Pass User
    res.json({ success: true });
});

// 4. TOGGLE STATION CONNECTION (Virtual Cable Pull)
router.post('/simulation/station/connection', authenticateToken, (req, res) => {
    const { id } = req.body;
    simulationService.toggleStationConnection(id);
    res.json({ success: true });
});

// 5. UPDATE RELAY CONFIG
router.post('/simulation/relay/config', authenticateToken, (req, res) => {
    const { id, bit, updates } = req.body;
    simulationService.updateRelayConfig(id, bit, updates);
    res.json({ success: true });
});

// 6. TOGGLE MANUAL INPUT
router.post('/simulation/input/toggle', authenticateToken, (req, res) => {
    const { id, bit } = req.body;
    simulationService.toggleManualInput(id, bit);
    res.json({ success: true });
});

// 9. UPDATE INPUT CONFIG
router.post('/simulation/input/config', authenticateToken, (req, res) => {
    const { id, bit, updates } = req.body;
    simulationService.updateInputConfig(id, bit, updates);
    res.json({ success: true });
});

module.exports = router;