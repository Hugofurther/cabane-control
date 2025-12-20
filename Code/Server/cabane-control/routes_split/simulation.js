const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const simulationService = require('../services/simulation_service');

// ============================================================
// 🎮 SIMULATION API ROUTES
// ============================================================

// 1. GET STATUS (Full Config + State)
router.get('/simulation/status', authenticateToken, (req, res) => {
    res.json(simulationService.getStatus());
});

// 2. TOGGLE SIMULATION (Master Switch)
router.post('/simulation/toggle', authenticateToken, requireAdmin, (req, res) => {
    const { active } = req.body;
    simulationService.setSimulationActive(active, req.user.username); // ✅ Pass User
    res.json({ success: true });
});

// 3. TOGGLE PHYSICAL LINK (Control Real Hardware via Sim)
router.post('/simulation/physical', authenticateToken, requireAdmin, (req, res) => {
    const { linked } = req.body;
    simulationService.togglePhysicalLink(linked, req.user.username); // ✅ Pass User
    res.json({ success: true });
});


// 4. TOGGLE STATION CONNECTION (Virtual Cable Pull)
router.post('/simulation/station/connection', authenticateToken, (req, res) => {
    const { id } = req.body;
    simulationService.toggleStationConnection(id);
    res.json({ success: true });
});

// 5. UPDATE RELAY CONFIG (Name, Linking, Target Mapping, Enabled)
router.post('/simulation/relay/config', authenticateToken, (req, res) => {
    const { id, bit, updates } = req.body;
    simulationService.updateRelayConfig(id, bit, updates);
    res.json({ success: true });
});

// 6. TOGGLE MANUAL INPUT (Force Input ON/OFF)
router.post('/simulation/input/toggle', authenticateToken, (req, res) => {
    const { id, bit } = req.body;
    simulationService.toggleManualInput(id, bit);
    res.json({ success: true });
});

// 7. TOGGLE INPUT AUTO MODE (Legacy/Direct)
router.post('/simulation/station/auto', authenticateToken, (req, res) => {
    const { id, bit, auto } = req.body;
    // Note: v6 logic mostly handles this via relay 'linked' prop, 
    // but this route remains for direct input manipulation if needed.
    // simulationService.setAutoBit(id, bit, auto); 
    res.json({ success: true });
});

// 8. RENAME INPUT (Direct)
router.post('/simulation/station/name', authenticateToken, (req, res) => {
    const { id, bit, name } = req.body;
    // Maps to input config update
    simulationService.updateInputConfig(id, bit, { name });
    res.json({ success: true });
});

// 9. UPDATE INPUT CONFIG (Generic)
router.post('/simulation/input/config', authenticateToken, (req, res) => {
    const { id, bit, updates } = req.body;
    simulationService.updateInputConfig(id, bit, updates);
    res.json({ success: true });
});

module.exports = router;