const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const simulationService = require('../services/simulation_service');

// 1. GET STATUS
router.get('/simulation/status', authenticateToken, (req, res) => {
    res.json(simulationService.getStatus());
});

// 2. TOGGLE SIMULATION
router.post('/simulation/toggle', authenticateToken, (req, res) => {
    const { active } = req.body;
    simulationService.setSimulationActive(active, req.user.username);
    res.json({ success: true });
});

// 3. ✅ RESTORED: TOGGLE PHYSICAL LINK
router.post('/simulation/physical', authenticateToken, (req, res) => {
    const { linked } = req.body;
    simulationService.togglePhysicalLink(linked, req.user.username);
    res.json({ success: true });
});

// 4. TOGGLE STATION CONNECTION
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

// 7. UPDATE INPUT CONFIG
router.post('/simulation/input/config', authenticateToken, (req, res) => {
    const { id, bit, updates } = req.body;
    simulationService.updateInputConfig(id, bit, updates);
    res.json({ success: true });
});

module.exports = router;