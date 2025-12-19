const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const simulationService = require('../services/simulation_service');

router.get('/simulation/status', authenticateToken, (req, res) => {
    res.json(simulationService.getStatus());
});

router.post('/simulation/toggle', authenticateToken, requireAdmin, (req, res) => {
    const { active } = req.body;
    simulationService.setSimulationActive(active);
    res.json({ success: true });
});

router.post('/simulation/station/connection', authenticateToken, (req, res) => {
    const { id } = req.body;
    simulationService.toggleStationConnection(id);
    res.json({ success: true });
});

router.post('/simulation/relay/config', authenticateToken, (req, res) => {
    const { id, bit, updates } = req.body;
    simulationService.updateRelayConfig(id, bit, updates);
    res.json({ success: true });
});

router.post('/simulation/input/toggle', authenticateToken, (req, res) => {
    const { id, bit } = req.body;
    simulationService.toggleManualInput(id, bit);
    res.json({ success: true });
});

module.exports = router;