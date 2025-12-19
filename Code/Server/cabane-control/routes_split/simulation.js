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

router.post('/simulation/station/auto', authenticateToken, (req, res) => {
    const { id, auto } = req.body;
    simulationService.setAuto(id, auto);
    res.json({ success: true });
});

router.post('/simulation/station/input', authenticateToken, (req, res) => {
    const { id, bit, value } = req.body; // value: true=ON, false=OFF
    simulationService.setInput(id, bit, value);
    res.json({ success: true });
});

module.exports = router;