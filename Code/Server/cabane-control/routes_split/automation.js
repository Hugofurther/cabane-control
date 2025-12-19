const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const automationService = require('../services/automation_service');

// GET STATUS
router.get('/automation/status', authenticateToken, (req, res) => {
    res.json({
        ...automationService.getStatus(),
        defaultConfig: automationService.getConfig()
    });
});

// START SEQUENCE (The Purple Button)
router.post('/automation/start', authenticateToken, (req, res) => {
    // ✅ LOGGING TO DEBUG API HIT
    console.log("[API] /automation/start hit with body:", req.body);

    const { startStep, shutdownEnabled, shutdownDuration } = req.body;
    try {
        automationService.startSequence(req.user.username, {
            startStep,
            shutdownEnabled,
            shutdownDuration
        });
        res.json({ success: true });
    } catch (e) {
        console.error("[API] Start Failed:", e);
        res.status(500).json({ error: e.message });
    }
});

// START STANDALONE SHUTDOWN (The Red Button)
router.post('/automation/shutdown', authenticateToken, (req, res) => {
    console.log("[API] /automation/shutdown hit with body:", req.body);
    const { duration } = req.body;
    try {
        automationService.startStandaloneShutdown(req.user.username, duration);
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