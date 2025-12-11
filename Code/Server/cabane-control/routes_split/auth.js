const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const { sendEmail } = require('../services/email_service');
const db = require('../db'); // ✅ Import Shared DB

const PUBLIC_URL = process.env.PUBLIC_URL || 'http://192.168.1.200:3000';

// Helpers
const normalize = (str) => str ? str.trim().toLowerCase() : '';
const validatePassword = (pwd) => {
    if (pwd.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(pwd)) return "Password must contain an Uppercase letter.";
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) return "Password must contain a Special Character.";
    return null;
};
const logAction = (io, userId, username, type, message) => {
    const timestamp = new Date().toISOString();
    db.run("INSERT INTO logs (user_id, type, message, timestamp) VALUES (?, ?, ?, ?)", [userId, type, message, timestamp]);
    if (io) io.emit('NEW_LOG', { id: Date.now(), timestamp, user_id: userId, username, type, message });
};

// --- ROUTES ---

router.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    const inputClean = normalize(username);
    db.get("SELECT * FROM users WHERE username = ? OR email = ?", [inputClean, inputClean], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: "Invalid credentials" });
        if (user.status !== 'ACTIVE') return res.status(403).json({ error: `Status: ${user.status}` });

        const validPass = await bcrypt.compare(password, user.password_hash);
        if (!validPass) return res.status(401).json({ error: "Invalid credentials" });

        let userSettings = {};
        try { userSettings = user.settings ? JSON.parse(user.settings) : {} } catch (e) { }
        const expiresIn = userSettings.tokenExpiration || '60d';

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn });
        logAction(req.io, user.id, user.username, 'AUTH', 'Logged In');
        res.json({ token, username: user.username, role: user.role, settings: userSettings });
    });
});

router.post('/auth/register', async (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password || !email) return res.status(400).json({ error: "Missing fields" });

    const pwdError = validatePassword(password);
    if (pwdError) return res.status(400).json({ error: pwdError });

    try {
        const hash = await bcrypt.hash(password, 10);
        const token = crypto.randomBytes(32).toString('hex');
        const defaultSettings = JSON.stringify({ soundEnabled: true, vibrationEnabled: true, clockFormat: '24h' });

        const stmt = db.prepare("INSERT INTO users (username, password_hash, email, status, verification_token, settings) VALUES (?, ?, ?, 'UNVERIFIED', ?, ?)");
        stmt.run(normalize(username), hash, normalize(email), token, defaultSettings, async function (err) {
            if (err) return res.status(500).json({ error: "Database error" });
            const link = `${PUBLIC_URL}/verify-email?token=${token}`;
            await sendEmail(normalize(email), "Cabane Control - Verify Account", `<p>Click here: <a href="${link}">Verify Email</a></p>`);
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
        res.json({ success: true });
    });
});

router.get('/auth/me', authenticateToken, (req, res) => {
    db.get("SELECT id, username, role, email, settings, can_control, can_view_logs FROM users WHERE id = ?", [req.user.id], (err, row) => {
        if (!row) return res.status(404).json({ error: "User not found" });
        let settings = {};
        try { settings = row.settings ? JSON.parse(row.settings) : {} } catch (e) { }
        res.json({ ...row, settings });
    });
});

router.post('/user/settings', authenticateToken, (req, res) => {
    db.run("UPDATE users SET settings = ? WHERE id = ?", [JSON.stringify(req.body.settings), req.user.id], (err) => res.json({ success: true }));
});

router.post('/user/password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    db.get("SELECT password_hash FROM users WHERE id = ?", [req.user.id], async (err, row) => {
        const valid = await bcrypt.compare(currentPassword, row.password_hash);
        if (!valid) return res.status(401).json({ error: "Current password incorrect" });
        const newHash = await bcrypt.hash(newPassword, 10);
        db.run("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, req.user.id], () => res.json({ success: true }));
    });
});

module.exports = router;