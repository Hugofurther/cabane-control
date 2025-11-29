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

module.exports = router;