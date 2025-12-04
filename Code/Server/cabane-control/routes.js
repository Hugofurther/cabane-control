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

// GET /api/users/directory (Visible to all logged-in users)
router.get('/users/directory', authenticateToken, (req, res) => {
    db.all("SELECT id, username, role, status, created_at FROM users WHERE status = 'ACTIVE'", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows);
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

// GET MESSAGES (Context Aware + Per-User Read Status)
router.get('/messages', authenticateToken, (req, res) => {
    const { type, targetId } = req.query;
    const userId = req.user.id;

    // SQL: Join with message_reads to see if THIS user has read the message
    // We return '1' as is_read_by_me if a record exists, else '0'
    let sql = `
    SELECT m.*, u.username as sender,
    CASE WHEN mr.read_at IS NOT NULL THEN 1 ELSE 0 END as is_read_by_me
    FROM messages m 
    JOIN users u ON m.sender_id = u.id 
    LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = ?
    WHERE 
  `;

    let params = [userId]; // First param is for the LEFT JOIN

    if (type === 'GLOBAL') {
        sql += `m.recipient_id IS NULL AND m.group_id IS NULL`;
    }
    else if (type === 'NOTES') {
        sql += `m.recipient_id = ? AND m.sender_id = ?`;
        params.push(userId, userId);
    }
    else if (type === 'DM') {
        sql += `((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)) AND m.group_id IS NULL`;
        params.push(userId, targetId, targetId, userId);
    }
    else if (type === 'GROUP') {
        sql += `m.group_id = ?`;
        params.push(targetId);
    }
    else {
        // DEFAULT FEED
        sql += `(m.recipient_id IS NULL AND m.group_id IS NULL) 
            OR (m.recipient_id = ? OR m.sender_id = ?) 
            OR (m.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?))`;
        params.push(userId, userId, userId);
    }

    sql += ` ORDER BY m.timestamp DESC LIMIT 100`;

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows.reverse());
    });
});

// POST /api/messages
router.post('/messages', authenticateToken, (req, res) => {
    const { content, recipientId, groupId, priority } = req.body;

    // Validation: Can't have both recipient and group
    const rId = recipientId || null;
    const gId = groupId || null;

    const stmt = db.prepare("INSERT INTO messages (sender_id, recipient_id, group_id, content, priority) VALUES (?, ?, ?, ?, ?)");
    stmt.run(req.user.id, rId, gId, content, priority || 'NORMAL', function (err) {
        if (err) return res.status(500).json({ error: "Send failed" });

        // Emit real-time event (Frontend needs to filter if it belongs in current view)
        if (req.io) {
            req.io.emit('NEW_MESSAGE', {
                id: this.lastID,
                timestamp: new Date().toISOString(),
                sender_id: req.user.id,
                sender: req.user.username,
                recipient_id: rId,
                group_id: gId,
                content,
                priority,
                is_read_by_me: 0
            });
        }
        res.json({ success: true, id: this.lastID });
    });
    stmt.finalize();
});

// MARK MESSAGES READ (Per User)
router.post('/messages/read', authenticateToken, (req, res) => {
    const { messageIds } = req.body;
    if (!messageIds || messageIds.length === 0) return res.json({ success: true });

    const userId = req.user.id;

    // Use a transaction for speed/safety
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)");

        messageIds.forEach(msgId => {
            stmt.run(msgId, userId);
        });

        stmt.finalize();
        db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: "Update failed" });
            res.json({ success: true });
        });
    });
});

// GET CONVERSATIONS (Inbox List with Members)
router.get('/conversations', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const conversations = [];

    // 1. Fixed Contexts
    conversations.push({ type: 'GLOBAL', name: 'Global Chat', id: 'global' });
    conversations.push({ type: 'NOTES', name: 'My Notes', id: 'notes' });

    // 2. Fetch Groups with Member Names
    const groupSql = `
    SELECT g.id, g.name, GROUP_CONCAT(u.username, ', ') as members 
    FROM groups g 
    JOIN group_members gm ON g.id = gm.group_id 
    JOIN users u ON gm.user_id = u.id
    WHERE g.id IN (SELECT group_id FROM group_members WHERE user_id = ?)
    GROUP BY g.id
  `;

    db.all(groupSql, [userId], (err, groups) => {
        if (err) console.error(err);
        if (groups) groups.forEach(g => conversations.push({
            type: 'GROUP',
            name: g.name,
            id: g.id,
            members: g.members // Added members string
        }));

        // 3. Fetch Recent DMs
        const dmSql = `
      SELECT DISTINCT u.id, u.username 
      FROM users u
      JOIN messages m ON (m.sender_id = u.id AND m.recipient_id = ?) 
                      OR (m.recipient_id = u.id AND m.sender_id = ?)
      WHERE u.id != ?
    `;

        db.all(dmSql, [userId, userId, userId], (err, users) => {
            if (users) users.forEach(u => conversations.push({ type: 'DM', name: u.username, id: u.id }));
            res.json(conversations);
        });
    });
});

// CREATE GROUP
router.post('/groups', authenticateToken, (req, res) => {
    const { name, memberIds } = req.body; // memberIds = array of user IDs
    if (!name) return res.status(400).json({ error: "Name required" });

    db.run("INSERT INTO groups (name) VALUES (?)", [name], function (err) {
        if (err) return res.status(500).json({ error: "DB Error" });
        const groupId = this.lastID;

        // Add Creator
        db.run("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)", [groupId, req.user.id]);

        // Add Members
        if (Array.isArray(memberIds)) {
            memberIds.forEach(uid => {
                db.run("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)", [groupId, uid]);
            });
        }
        res.json({ success: true, groupId });
    });
});

// LEAVE GROUP
router.post('/groups/leave', authenticateToken, (req, res) => {
    const { groupId } = req.body;
    const userId = req.user.id;

    db.serialize(() => {
        // 1. Remove Member
        db.run("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, userId]);

        // 2. Check if empty
        db.get("SELECT COUNT(*) as count FROM group_members WHERE group_id = ?", [groupId], (err, row) => {
            if (row && row.count === 0) {
                // Group is empty, delete the group entry (Messages remain as orphans with group_id)
                db.run("DELETE FROM groups WHERE id = ?", [groupId]);
            }
            res.json({ success: true });
        });
    });
});

// DELETE MESSAGE (Own messages only)
router.post('/messages/delete', authenticateToken, (req, res) => {
    const { messageId } = req.body;

    // Check ownership first
    db.get("SELECT sender_id FROM messages WHERE id = ?", [messageId], (err, row) => {
        if (!row) return res.status(404).json({ error: "Not found" });
        if (row.sender_id !== req.user.id) return res.status(403).json({ error: "Cannot delete others' messages" });

        db.run("DELETE FROM messages WHERE id = ?", [messageId], (err) => {
            if (err) return res.status(500).json({ error: "Delete failed" });
            // Emit deletion event so clients remove it instantly
            if (req.io) req.io.emit('DELETE_MESSAGE', { id: messageId });
            res.json({ success: true });
        });
    });
});

// DOWNGRADE URGENCY
router.post('/messages/downgrade', authenticateToken, (req, res) => {
    const { messageId } = req.body;

    db.run("UPDATE messages SET priority = 'NORMAL' WHERE id = ?", [messageId], (err) => {
        if (err) return res.status(500).json({ error: "Update failed" });

        // Emit update event
        if (req.io) req.io.emit('UPDATE_MESSAGE', { id: messageId, priority: 'NORMAL' });
        res.json({ success: true });
    });
});

module.exports = router;