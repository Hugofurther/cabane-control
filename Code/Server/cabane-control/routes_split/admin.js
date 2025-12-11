const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const db = require('../db'); // ✅ Import Shared DB
const checkDiskSpace = require('check-disk-space').default;
const logicEngine = require('../services/logic_engine');

// Helper to Log
const logAction = (io, userId, username, type, message) => {
    const timestamp = new Date().toISOString();
    db.run("INSERT INTO logs (user_id, type, message, timestamp) VALUES (?, ?, ?, ?)", [userId, type, message, timestamp]);
    if (io) io.emit('NEW_LOG', { id: Date.now(), timestamp, user_id: userId, username, type, message });
};

router.get('/system/status', authenticateToken, async (req, res) => {
    try {
        const space = await checkDiskSpace('/');
        res.json({ diskUsage: `${Math.round(((space.size - space.free) / space.size) * 100)}%`, free: space.free, size: space.size });
    } catch (e) { res.json({ diskUsage: 'Unknown', free: 0, size: 0 }); }
});

router.get('/logs', authenticateToken, (req, res) => {
    db.get("SELECT role, can_view_logs FROM users WHERE id = ?", [req.user.id], (err, user) => {
        if (!user || (user.role !== 'ADMIN' && !user.can_view_logs)) return res.status(403).json();
        db.all(`SELECT l.*, u.username FROM logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.timestamp DESC LIMIT ?`, [parseInt(req.query.limit) || 100], (err, rows) => res.json(rows));
    });
});

// Control
router.post('/control/take', authenticateToken, (req, res) => {
    db.get("SELECT can_control FROM users WHERE id = ?", [req.user.id], (err, row) => {
        if (!row || !row.can_control) return res.status(403).json({ error: "Permission denied" });
        logicEngine.takeControl(req.user.username);
        logAction(req.io, req.user.id, req.user.username, 'CONTROL', 'Took Control');
        res.json({ success: true });
    });
});

router.post('/control/toggle', authenticateToken, (req, res) => {
    const { index, value } = req.body;
    if (logicEngine.getFullState().controller === 'CABANE') return res.status(403).json({ error: "In Cabane Mode" });
    if (logicEngine.getFullState().currentUser !== req.user.username) return res.status(403).json({ error: "Not active controller" });
    logicEngine.toggleSwitch(index, value, req.user.username);
    logAction(req.io, req.user.id, req.user.username, 'SWITCH', `Toggled Switch ${index} ${value ? 'ON' : 'OFF'}`);
    res.json({ success: true });
});

// Admin User Mgmt
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
    db.all("SELECT id, username, email, role, status, can_control, can_view_logs, created_at FROM users", [], (err, rows) => res.json(rows));
});
router.post('/users/approve', authenticateToken, requireAdmin, (req, res) => {
    db.run("UPDATE users SET status = 'ACTIVE' WHERE id = ?", [req.body.userId], () => res.json({ success: true }));
});
// ... [Include permission/delete/transfer admin routes here] ...

module.exports = router;