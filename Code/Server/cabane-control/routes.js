// ============================================================
// 🛣️ API ROUTES (Express Router)
// ============================================================
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const logicEngine = require('./services/logic_engine');
const { authenticateToken, requireAdmin } = require('./middleware/auth');

// Connect to Database
const db = new sqlite3.Database('./cabane.db');

// ============================================================
// 🔐 AUTHENTICATION
// ============================================================

// POST /api/auth/register
router.post('/auth/register', async (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });

    try {
        const hash = await bcrypt.hash(password, 10);
        const stmt = db.prepare("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)");

        stmt.run(username, hash, email, function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(409).json({ error: "Username taken" });
                return res.status(500).json({ error: "Database error" });
            }
            res.json({ message: "Registration successful. Pending admin approval." });
        });
        stmt.finalize();
    } catch (e) {
        res.status(500).json({ error: "Server error" });
    }
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
            { expiresIn: '12h' }
        );

        res.json({ token, username: user.username, role: user.role });
    });
});

// GET /api/auth/me (Verify Token)
router.get('/auth/me', authenticateToken, (req, res) => {
    res.json({
        id: req.user.id,
        username: req.user.username,
        role: req.user.role
    });
});

// ============================================================
// 👑 ADMIN MANAGEMENT
// ============================================================

// GET /api/users
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
    db.all("SELECT id, username, email, role, status, created_at FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows);
    });
});

// POST /api/users/approve
router.post('/users/approve', authenticateToken, requireAdmin, (req, res) => {
    const { userId } = req.body;
    db.run("UPDATE users SET status = 'ACTIVE' WHERE id = ?", [userId], function (err) {
        if (err) return res.status(500).json({ error: "Update failed" });
        res.json({ success: true });
    });
});

// ============================================================
// 🏭 CONTROL SYSTEM
// ============================================================

// POST /api/control/take
// User takes control (Overrides Cabane OR Server)
router.post('/control/take', authenticateToken, (req, res) => {
    logicEngine.takeControl(req.user.username);

    db.run("INSERT INTO logs (user_id, type, message) VALUES (?, ?, ?)",
        [req.user.id, 'CONTROL', 'User took control']);

    res.json({ success: true });
});

// POST /api/control/release-server
// User releases, but Server keeps control (Headless mode / Holding state)
router.post('/control/release-server', authenticateToken, (req, res) => {
    logicEngine.releaseToServer();

    db.run("INSERT INTO logs (user_id, type, message) VALUES (?, ?, ?)",
        [req.user.id, 'CONTROL', 'User released to Server (Holding State)']);

    res.json({ success: true });
});

// POST /api/control/release-cabane
// Full release back to Physical Main Controller
router.post('/control/release-cabane', authenticateToken, (req, res) => {
    logicEngine.releaseToCabane();

    db.run("INSERT INTO logs (user_id, type, message) VALUES (?, ?, ?)",
        [req.user.id, 'CONTROL', 'System released to Cabane']);

    res.json({ success: true });
});

// POST /api/control/toggle
// Change a virtual switch state
router.post('/control/toggle', authenticateToken, (req, res) => {
    const { index, value } = req.body;

    // Check if we are allowed to toggle (Must be USER or SERVER mode)
    const state = logicEngine.getFullState();
    if (state.controller === 'CABANE') {
        return res.status(403).json({ error: "System is in Cabane Mode. Take control first." });
    }

    logicEngine.toggleSwitch(index, value);
    res.json({ success: true });
});

// ============================================================
// 💬 MESSAGING SYSTEM
// ============================================================

// GET /api/messages
router.get('/messages', authenticateToken, (req, res) => {
    // Get last 50 global messages OR messages involving this user
    const sql = `
    SELECT m.id, m.content, m.timestamp, u.username as sender 
    FROM messages m 
    JOIN users u ON m.sender_id = u.id
    WHERE m.recipient_id IS NULL OR m.recipient_id = ? OR m.sender_id = ?
    ORDER BY m.timestamp DESC LIMIT 50
  `;

    db.all(sql, [req.user.id, req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows.reverse()); // Oldest first
    });
});

// POST /api/messages
router.post('/messages', authenticateToken, (req, res) => {
    const { content, recipientId } = req.body;

    const stmt = db.prepare("INSERT INTO messages (sender_id, recipient_id, content) VALUES (?, ?, ?)");
    stmt.run(req.user.id, recipientId || null, content, function (err) {
        if (err) return res.status(500).json({ error: "Send failed" });
        res.json({ success: true, id: this.lastID });
    });
    stmt.finalize();
});

module.exports = router;