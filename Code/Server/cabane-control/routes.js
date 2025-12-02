// ============================================================
// 🛣️ API ROUTES (Express Router)
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

// Connect to Database
const db = new sqlite3.Database('./cabane.db');

// Config
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://192.168.1.200:3000';

// ============================================================
// 🔐 AUTHENTICATION & RECOVERY
// ============================================================

// 1. REGISTER -> Send Verification Email
router.post('/auth/register', async (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password || !email) return res.status(400).json({ error: "Missing fields" });

    try {
        const hash = await bcrypt.hash(password, 10);
        const token = crypto.randomBytes(32).toString('hex'); // Verification Token

        const stmt = db.prepare("INSERT INTO users (username, password_hash, email, status, verification_token) VALUES (?, ?, ?, 'UNVERIFIED', ?)");

        stmt.run(username, hash, email, token, async function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(409).json({ error: "Username or Email taken" });
                return res.status(500).json({ error: "Database error" });
            }

            // Send Email
            const link = `${PUBLIC_URL}/verify-email?token=${token}`;
            await sendEmail(email, "Cabane Control - Verify your Cabane Account",
                `<p>Click here to verify your email: <a href="${link}">Verify Email</a></p>`);

            res.json({ message: "Registration successful. Please check your email to verify." });
        });
        stmt.finalize();
    } catch (e) {
        res.status(500).json({ error: "Server error" });
    }
});

// 2. VERIFY EMAIL -> Notify Admin
router.post('/auth/verify', (req, res) => {
    const { token } = req.body;

    db.get("SELECT * FROM users WHERE verification_token = ?", [token], async (err, user) => {
        if (!user) return res.status(400).json({ error: "Invalid token" });

        // Update status to PENDING (Waiting for Admin)
        db.run("UPDATE users SET status = 'PENDING', verification_token = NULL WHERE id = ?", [user.id]);

        // Notify Admin
        const adminEmail = process.env.ADMIN_EMAIL || 'hugofurther@gmail.com';

        await sendEmail(adminEmail, "Cabane Control - New User Pending Approval",
            `<p>User <b>${user.username}</b> (${user.email}) has verified their email.</p>
       <p>Please login to approve or reject them:</p>
       <p><a href="${PUBLIC_URL}">Open Cabane Control</a></p>`
        );

        res.json({ success: true, message: "Email verified. Admin has been notified." });
    });
});

// 3. LOGIN
router.post('/auth/login', (req, res) => {
    const { username, password } = req.body;

    // Logic: Check Username OR Email
    const sql = "SELECT * FROM users WHERE username = ? OR email = ?";

    db.get(sql, [username, username], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: "Invalid credentials" });

        // Status Checks
        if (user.status === 'UNVERIFIED') return res.status(403).json({ error: "Please verify your email first." });
        if (user.status === 'PENDING') return res.status(403).json({ error: "Account pending Admin approval." });
        if (user.status === 'REJECTED') return res.status(403).json({ error: "Account rejected." });

        const validPass = await bcrypt.compare(password, user.password_hash);
        if (!validPass) return res.status(401).json({ error: "Invalid credentials" });

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        res.json({ token, username: user.username, role: user.role });
    });
});

// 4. FORGOT PASSWORD -> Send Reset Link
router.post('/auth/forgot-password', (req, res) => {
    const { email } = req.body;
    const token = crypto.randomBytes(32).toString('hex');

    db.run("UPDATE users SET reset_token = ? WHERE email = ?", [token, email], async function (err) {
        if (this.changes > 0) {
            const link = `${PUBLIC_URL}/reset-password?token=${token}`;
            await sendEmail(email, "Cabane Control - Password Reset",
                `<p>Click here to reset: <a href="${link}">Reset Password</a></p>`);
        }
        res.json({ message: "If account exists, email sent." });
    });
});

// 5. RESET PASSWORD -> Update DB
router.post('/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    const hash = await bcrypt.hash(newPassword, 10);

    db.run("UPDATE users SET password_hash = ?, reset_token = NULL WHERE reset_token = ?",
        [hash, token],
        function (err) {
            if (this.changes === 0) return res.status(400).json({ error: "Invalid or expired token" });
            res.json({ success: true, message: "Password updated. Please login." });
        }
    );
});

// GET /api/auth/me
router.get('/auth/me', authenticateToken, (req, res) => {
    res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

// ============================================================
// 👑 ADMIN MANAGEMENT
// ============================================================

router.get('/users', authenticateToken, requireAdmin, (req, res) => {
    db.all("SELECT id, username, email, role, status, created_at FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows);
    });
});

// APPROVE USER
router.post('/users/approve', authenticateToken, requireAdmin, (req, res) => {
    const { userId } = req.body;

    db.get("SELECT email FROM users WHERE id = ?", [userId], (err, user) => {
        if (!user) return res.status(404).json({ error: "User not found" });

        db.run("UPDATE users SET status = 'ACTIVE' WHERE id = ?", [userId], async () => {
            // Notify User
            await sendEmail(user.email, "Cabane Control - Account Approved",
                `<p>Your account is active. <a href="${PUBLIC_URL}">Login here</a></p>`);
            res.json({ success: true });
        });
    });
});

// DELETE USER
router.post('/users/delete', authenticateToken, requireAdmin, (req, res) => {
    const { userId } = req.body;
    if (userId === req.user.id) return res.status(400).json({ error: "Cannot delete yourself" });

    db.run("DELETE FROM users WHERE id = ?", [userId], function (err) {
        if (err) return res.status(500).json({ error: "Delete failed" });
        if (this.changes === 0) return res.status(404).json({ error: "User not found" });
        res.json({ success: true });
    });
});

// ============================================================
// 🏭 CONTROL SYSTEM
// ============================================================

// POST /api/control/take
router.post('/control/take', authenticateToken, (req, res) => {
    console.log(`API: Take Control requested by ${req.user.username}`);

    logicEngine.takeControl(req.user.username);

    db.run("INSERT INTO logs (user_id, type, message) VALUES (?, ?, ?)",
        [req.user.id, 'CONTROL', 'User took control']);

    res.json({ success: true });
});

// POST /api/control/release-server
router.post('/control/release-server', authenticateToken, (req, res) => {
    console.log(`API: Release to Server requested by ${req.user.username}`);

    logicEngine.releaseToServer();

    db.run("INSERT INTO logs (user_id, type, message) VALUES (?, ?, ?)",
        [req.user.id, 'CONTROL', 'User released to Server (Holding State)']);

    res.json({ success: true });
});

// POST /api/control/release-cabane
router.post('/control/release-cabane', authenticateToken, (req, res) => {
    console.log(`API: Release to Cabane requested by ${req.user.username}`);

    logicEngine.releaseToCabane();

    db.run("INSERT INTO logs (user_id, type, message) VALUES (?, ?, ?)",
        [req.user.id, 'CONTROL', 'System released to Cabane']);

    res.json({ success: true });
});

// POST /api/control/toggle
router.post('/control/toggle', authenticateToken, (req, res) => {
    const { index, value } = req.body;

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

router.get('/messages', authenticateToken, (req, res) => {
    const sql = `
    SELECT m.id, m.content, m.timestamp, u.username as sender 
    FROM messages m 
    JOIN users u ON m.sender_id = u.id
    WHERE m.recipient_id IS NULL OR m.recipient_id = ? OR m.sender_id = ?
    ORDER BY m.timestamp DESC LIMIT 50
  `;

    db.all(sql, [req.user.id, req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows.reverse());
    });
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