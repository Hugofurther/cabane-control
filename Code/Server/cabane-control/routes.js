// ============================================================
// 🛣️ API ROUTES - FULL PRODUCTION (vFinal)
// ============================================================
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const logicEngine = require('./services/logic_engine');
const { authenticateToken, requireAdmin } = require('./middleware/auth');
const { sendEmail } = require('./services/email_service');
const { exec } = require('child_process');

const db = new sqlite3.Database('./cabane.db');
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://192.168.1.200:3000';

// --- HELPERS ---
const normalize = (str) => str ? str.trim().toLowerCase() : '';

const validatePassword = (pwd) => {
    if (pwd.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(pwd)) return "Password must contain an Uppercase letter.";
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) return "Password must contain a Special Character.";
    return null;
};

// GET SYSTEM STATUS (Disk Usage)
router.get('/system/status', authenticateToken, requireAdmin, (req, res) => {
    // Run 'df -h' on root, take last line, print 5th column (Use%)
    exec("df -h / | tail -1 | awk '{print $5}'", (error, stdout, stderr) => {
        if (error) {
            return res.json({ diskUsage: "Unknown" });
        }
        res.json({ diskUsage: stdout.trim() });
    });
});

// Helper to Log & Emit
const logAction = (io, userId, username, type, message) => {
    const timestamp = new Date().toISOString();
    db.run("INSERT INTO logs (user_id, type, message, timestamp) VALUES (?, ?, ?, ?)",
        [userId, type, message, timestamp]);

    if (io) {
        io.emit('NEW_LOG', {
            id: Date.now(), timestamp, user_id: userId, username, type, message
        });
    }
};

// ============================================================
// 🔐 AUTHENTICATION
// ============================================================

router.post('/auth/register', async (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password || !email) return res.status(400).json({ error: "Missing fields" });

    const pwdError = validatePassword(password);
    if (pwdError) return res.status(400).json({ error: pwdError });

    const userClean = normalize(username);
    const emailClean = normalize(email);

    try {
        const hash = await bcrypt.hash(password, 10);
        const token = crypto.randomBytes(32).toString('hex');
        const defaultSettings = JSON.stringify({ soundEnabled: true, vibrationEnabled: true, clockFormat: '24h' });

        const stmt = db.prepare("INSERT INTO users (username, password_hash, email, status, verification_token, settings) VALUES (?, ?, ?, 'UNVERIFIED', ?, ?)");
        stmt.run(userClean, hash, emailClean, token, defaultSettings, async function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(409).json({ error: "Username or Email taken" });
                return res.status(500).json({ error: "Database error" });
            }
            const link = `${PUBLIC_URL}/verify-email?token=${token}`;
            await sendEmail(emailClean, "Cabane Control - Verify Account",
                `<p>Click here: <a href="${link}">Verify Email</a></p>`);
            res.json({ message: "Registration successful." });
        });
        stmt.finalize();
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

router.post('/auth/verify', (req, res) => {
    const { token } = req.body;
    db.get("SELECT * FROM users WHERE verification_token = ?", [token], async (err, user) => {
        if (!user) return res.status(400).json({ error: "Invalid token" });
        db.run("UPDATE users SET status = 'PENDING', verification_token = NULL WHERE id = ?", [user.id]);

        const adminEmail = process.env.ADMIN_EMAIL || 'hugofurther@gmail.com';
        await sendEmail(adminEmail, "Cabane Control - New User Pending",
            `<p>User <b>${user.username}</b> verified email. <a href="${PUBLIC_URL}">Approve Here</a></p>`);
        res.json({ success: true });
    });
});

router.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    const inputClean = normalize(username);
    const sql = "SELECT * FROM users WHERE username = ? OR email = ?";

    db.get(sql, [inputClean, inputClean], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: "Invalid credentials" });
        if (user.status !== 'ACTIVE') return res.status(403).json({ error: `Status: ${user.status}` });

        const validPass = await bcrypt.compare(password, user.password_hash);
        if (!validPass) return res.status(401).json({ error: "Invalid credentials" });

        let userSettings = {};
        try { userSettings = user.settings ? JSON.parse(user.settings) : {} } catch (e) { }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET, { expiresIn: '12h' }
        );

        // Log Login
        logAction(req.io, user.id, user.username, 'AUTH', 'Logged In');
        res.json({ token, username: user.username, role: user.role, settings: userSettings });
    });
});

router.post('/auth/forgot-password', (req, res) => {
    const { email } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    db.run("UPDATE users SET reset_token = ? WHERE email = ?", [token, email], async function (err) {
        if (this.changes > 0) {
            const link = `${PUBLIC_URL}/reset-password?token=${token}`;
            await sendEmail(email, "Cabane Control - Password Reset", `<a href="${link}">Reset Password</a>`);
        }
        res.json({ message: "If account exists, email sent." });
    });
});

router.post('/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    const hash = await bcrypt.hash(newPassword, 10);
    db.run("UPDATE users SET password_hash = ?, reset_token = NULL WHERE reset_token = ?", [hash, token], function (err) {
        if (this.changes === 0) return res.status(400).json({ error: "Invalid token" });
        res.json({ success: true });
    }
    );
});

router.get('/auth/me', authenticateToken, (req, res) => {
    db.get("SELECT id, username, role, email, settings, can_control, can_view_logs FROM users WHERE id = ?", [req.user.id], (err, row) => {
        if (!row) return res.status(404).json({ error: "User not found" });
        let settings = {};
        try { settings = row.settings ? JSON.parse(row.settings) : {} } catch (e) { }
        res.json({
            id: row.id, username: row.username, email: row.email, role: row.role,
            settings: settings, can_control: !!row.can_control, can_view_logs: !!row.can_view_logs
        });
    });
});

// ============================================================
// ⚙️ SYSTEM & USER SETTINGS
// ============================================================

// GET ALL SYSTEM SETTINGS (Timezone, Weather, etc.)
router.get('/system/settings', authenticateToken, (req, res) => {
    db.all("SELECT key, value FROM system_settings", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });

        // Convert array [{key:'a', value:'b'}] -> object {a:'b'}
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        res.json(settings);
    });
});

// UPDATE SYSTEM SETTINGS (Admin Only) - GENERIC HANDLER
router.post('/system/settings', authenticateToken, requireAdmin, (req, res) => {
    const settings = req.body; // { timezone: '...', weather_lat: '...', ... }
    const keys = Object.keys(settings);

    if (keys.length === 0) return res.status(400).json({ error: "No settings provided" });

    let completed = 0;
    let errors = 0;

    keys.forEach(key => {
        db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)",
            [key, String(settings[key])],
            (err) => {
                if (err) errors++;
                completed++;

                if (completed === keys.length) {
                    // Reload ALL settings into logic engine
                    // (Ideally, logicEngine should have a .reloadSettings() method)
                    // For now, simple restart or specialized update:
                    if (settings.disabled_stations) logicEngine.updateDisabled(settings.disabled_stations);
                    if (settings.timezone) logicEngine.updateTimezone(settings.timezone);

                    res.json({ success: true });
                }
            }
        );
    });
});

router.post('/user/settings', authenticateToken, (req, res) => {
    const settingsStr = JSON.stringify(req.body.settings);
    db.run("UPDATE users SET settings = ? WHERE id = ?", [settingsStr, req.user.id], (err) => {
        res.json({ success: true });
    });
});

router.post('/user/profile', authenticateToken, (req, res) => {
    const { newUsername, newEmail } = req.body;
    const userClean = normalize(newUsername);
    const emailClean = normalize(newEmail);
    db.run("UPDATE users SET username = ?, email = ? WHERE id = ?", [userClean, emailClean, req.user.id], function (err) {
        if (err) return res.status(400).json({ error: "Username/Email taken" });
        res.json({ success: true });
    }
    );
});

router.post('/user/password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const pwdError = validatePassword(newPassword);
    if (pwdError) return res.status(400).json({ error: pwdError });

    db.get("SELECT password_hash FROM users WHERE id = ?", [req.user.id], async (err, row) => {
        const valid = await bcrypt.compare(currentPassword, row.password_hash);
        if (!valid) return res.status(401).json({ error: "Current password incorrect" });
        const newHash = await bcrypt.hash(newPassword, 10);
        db.run("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, req.user.id], (err) => {
            res.json({ success: true });
        });
    });
});

// ============================================================
// 👑 ADMIN
// ============================================================

router.get('/users', authenticateToken, requireAdmin, (req, res) => {
    db.all("SELECT id, username, email, role, status, can_control, can_view_logs, created_at FROM users", [], (err, rows) => {
        res.json(rows);
    });
});

router.post('/users/approve', authenticateToken, requireAdmin, (req, res) => {
    const { userId } = req.body;
    db.get("SELECT email FROM users WHERE id = ?", [userId], (err, user) => {
        if (!user) return res.status(404).json();
        db.run("UPDATE users SET status = 'ACTIVE' WHERE id = ?", [userId], async () => {
            await sendEmail(user.email, "Cabane Control - Account Approved", `<a href="${PUBLIC_URL}">Login</a>`);
            res.json({ success: true });
        });
    });
});

router.post('/users/permission', authenticateToken, requireAdmin, (req, res) => {
    const { userId, type, value } = req.body;
    const col = type === 'control' ? 'can_control' : 'can_view_logs';
    db.run(`UPDATE users SET ${col} = ? WHERE id = ?`, [value ? 1 : 0, userId], (err) => {
        res.json({ success: true });
    });
});

router.post('/users/delete', authenticateToken, requireAdmin, (req, res) => {
    const { userId } = req.body;
    if (userId === req.user.id) return res.status(400).json({ error: "Cannot delete self" });
    db.run("DELETE FROM users WHERE id = ?", [userId], function (err) {
        if (this.changes === 0) return res.status(404).json();
        res.json({ success: true });
    });
});

// ============================================================
// 🏭 CONTROL
// ============================================================

router.post('/control/take', authenticateToken, (req, res) => {
    // Verify Permission First
    db.get("SELECT can_control FROM users WHERE id = ?", [req.user.id], (err, row) => {
        if (!row || !row.can_control) return res.status(403).json({ error: "Permission denied" });

        logicEngine.takeControl(req.user.username);
        logAction(req.io, req.user.id, req.user.username, 'CONTROL', 'Took Control');
        res.json({ success: true });
    });
});

router.post('/control/release-server', authenticateToken, (req, res) => {
    logicEngine.releaseToServer();
    logAction(req.io, req.user.id, req.user.username, 'CONTROL', 'Released to Server');
    res.json({ success: true });
});

router.post('/control/release-cabane', authenticateToken, (req, res) => {
    logicEngine.releaseToCabane();
    logAction(req.io, req.user.id, req.user.username, 'CONTROL', 'Released to Cabane');
    res.json({ success: true });
});

// POST /api/control/toggle
router.post('/control/toggle', authenticateToken, (req, res) => {
    const { index, value } = req.body;

    const state = logicEngine.getFullState();

    // 1. Check if Cabane is Master
    if (state.controller === 'CABANE') {
        return res.status(403).json({ error: "System is in Cabane Mode. Take control first." });
    }

    // 2. Check if Requesting User is the Current Driver
    // If controller is SERVER, no user is driving -> Deny
    // If controller is USER, but username doesn't match -> Deny
    if (state.controller === 'SERVER' || state.currentUser !== req.user.username) {
        return res.status(403).json({ error: "You are not the active controller. Please Take Control." });
    }

    logicEngine.toggleSwitch(index, value, req.user.username);

    // Log switch change
    // (Logic Engine logs text, but we can add structured log here too if needed)
    // logicEngine.toggleSwitch handles the logging internally in your current setup.

    res.json({ success: true });
});

// ============================================================
// 💬 MESSAGES & LOGS
// ============================================================

router.get('/logs', authenticateToken, (req, res) => {
    db.get("SELECT can_view_logs FROM users WHERE id = ?", [req.user.id], (err, row) => {
        if (!row || !row.can_view_logs) return res.status(403).json({ error: "Denied" });
        const limit = req.query.limit || 100;
        const sql = `SELECT l.*, u.username FROM logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.timestamp DESC LIMIT ?`;
        db.all(sql, [limit], (err, rows) => res.json(rows));
    });
});

router.get('/messages', authenticateToken, (req, res) => {
    const sql = `SELECT m.*, u.username as sender FROM messages m JOIN users u ON m.sender_id = u.id 
               WHERE m.recipient_id IS NULL OR m.recipient_id = ? OR m.sender_id = ? ORDER BY m.timestamp DESC LIMIT 50`;
    db.all(sql, [req.user.id, req.user.id], (err, rows) => res.json(rows.reverse()));
});

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