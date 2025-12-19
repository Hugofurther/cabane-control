const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const automationService = require('../services/automation_service');

router.get('/automation/status', authenticateToken, (req, res) => {
    res.json(automationService.getStatus());
});

router.post('/automation/start', authenticateToken, (req, res) => {
    const { startStep } = req.body;
    try {
        automationService.startSequence(req.user.username, startStep || 1);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/automation/stop', authenticateToken, (req, res) => {
    automationService.stop();
    res.json({ success: true });
});

router.post('/automation/pause', authenticateToken, (req, res) => {
    automationService.pause();
    res.json({ success: true });
});

router.post('/automation/resume', authenticateToken, (req, res) => {
    automationService.resume();
    res.json({ success: true });
});

router.post('/automation/jump', authenticateToken, (req, res) => {
    const { step } = req.body;
    automationService.jump(step);
    res.json({ success: true });
});

module.exports = router;