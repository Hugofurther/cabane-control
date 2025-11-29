const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const logicEngine = require('./services/logic_engine');
const { authenticateToken, requireAdmin } = require('./middleware/auth');

const db = new sqlite3.Database('./cabane.db');

// ============================================================
// 🔐 AUTHENTICATION
// ============================================================

// POST /api/auth/register
router.post('/auth/register', async (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });

    const hash = await bcrypt.hash(password, 10);

    const stmt = db.prepare("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)");
    stmt.run(username, hash, email, function (err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.status(409).json({ error: "Username taken" });
            return res.status(500).json({ error: "Database error" });
        }
        // TODO: Send Email to Admin here
        res.json({ message: "Registration successful. Pending admin approval." });
    });
    stmt.finalize();
});

// POST /api/auth/login
router.post('/auth/login', (req, res) => {
    const { username, password } = req.body;

    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: "Invalid credentials" });

        if (user.status !== 'ACTIVE') return res.status(403).json({ error: "Account pending approval" });

        const validPass = await bcrypt.compare(password, user.password_hash);
        if (!validPass) return res.status(401).json({ error: "Invalid credentials" });

        // Generate Token
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '12h' } // Token lasts 12 hours
        );

        res.json({ token, username: user.username, role: user.role });
    });
});

// GET /api/auth/me
router.get('/auth/me', authenticateToken, (req, res) => {
    // Return info about the token holder
    res.json({
        id: req.user.id,
        username: req.user.username,
        role: req.user.role
    });
});

// ============================================================
// 🔑 Admin Only
// ============================================================

// GET /api/users (Admin Only)
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
    db.all("SELECT id, username, email, role, status, created_at FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows);
    });
});

// POST /api/users/approve (Admin Only)
router.post('/users/approve', authenticateToken, requireAdmin, (req, res) => {
    const { userId } = req.body;
    db.run("UPDATE users SET status = 'ACTIVE' WHERE id = ?", [userId], function (err) {
        if (err) return res.status(500).json({ error: "Update failed" });
        res.json({ success: true });
        // TODO: Send Email Notification to User
    });
});

// ============================================================
// 🏭 CONTROL (Protected)
// ============================================================

// POST /api/control/take
router.post('/control/take', authenticateToken, (req, res) => {
    logicEngine.takeControl(req.user.username);
    // Log it
    db.run("INSERT INTO logs (user_id, type, message) VALUES (?, ?, ?)",
        [req.user.id, 'CONTROL', 'Took control of System']);
    res.json({ success: true });
});

// POST /api/control/release
router.post('/control/release', authenticateToken, (req, res) => {
    logicEngine.releaseControl();
    db.run("INSERT INTO logs (user_id, type, message) VALUES (?, ?, ?)",
        [req.user.id, 'CONTROL', 'Released control']);
    res.json({ success: true });
});

// POST /api/control/toggle
// Body: { index: 0-23, value: true/false }
router.post('/control/toggle', authenticateToken, (req, res) => {
    const { index, value } = req.body;

    const state = logicEngine.getFullState();
    if (state.controller !== 'USER') {
        return res.status(403).json({ error: "System is in Cabane Mode. Take control first." });
    }

    logicEngine.toggleSwitch(index, value);
    res.json({ success: true });
});

// ============================================================
// 📩 MESSAGING
// ============================================================

// GET /api/messages
router.get('/messages', authenticateToken, (req, res) => {
    // Get last 50 global messages OR messages to/from this user
    const sql = `
    SELECT m.id, m.content, m.timestamp, u.username as sender 
    FROM messages m 
    JOIN users u ON m.sender_id = u.id
    WHERE m.recipient_id IS NULL OR m.recipient_id = ? OR m.sender_id = ?
    ORDER BY m.timestamp DESC LIMIT 50
  `;

    db.all(sql, [req.user.id, req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows.reverse()); // Send oldest first for chat UI
    });
});

// POST /api/messages
router.post('/messages', authenticateToken, (req, res) => {
    const { content, recipientId } = req.body;

    const stmt = db.prepare("INSERT INTO messages (sender_id, recipient_id, content) VALUES (?, ?, ?)");
    stmt.run(req.user.id, recipientId || null, content, function (err) {
        if (err) return res.status(500).json({ error: "Send failed" });

        // Broadcast to Websockets immediately
        // Note: We need to import 'io' here or emit via LogicEngine helper
        // For now, simpler to just save. The Frontend will rely on polling or we add socket emit later.
        res.json({ success: true, id: this.lastID });
    });
});

module.exports = router;