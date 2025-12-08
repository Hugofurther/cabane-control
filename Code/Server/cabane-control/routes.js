// ============================================================
// 🛣️ API ROUTES - FINAL PRODUCTION (v3 Fixed Read Status)
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
// ⚙️ SETTINGS
// ============================================================

router.get('/system/settings', authenticateToken, (req, res) => {
    db.all("SELECT key, value FROM system_settings", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        res.json(settings);
    });
});

router.post('/system/settings', authenticateToken, requireAdmin, (req, res) => {
    const settings = req.body;
    const keys = Object.keys(settings);
    if (keys.length === 0) return res.status(400).json({ error: "No settings" });

    let completed = 0;
    keys.forEach(key => {
        db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)",
            [key, String(settings[key])], (err) => {
                completed++;
                if (completed === keys.length) {
                    if (settings.timezone && logicEngine.updateTimezone) logicEngine.updateTimezone(settings.timezone);
                    if (settings.disabled_stations && logicEngine.updateDisabled) logicEngine.updateDisabled(settings.disabled_stations);

                    // Check Weather settings
                    if (settings.weather_locations || settings.weather_update_interval) {
                        // Require weather service if available in scope, or assume service handles poll
                        const weatherService = require('./services/weather_service');
                        if (weatherService.reloadSettings) weatherService.reloadSettings();
                    }
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

        // ✅ Trigger Check
        reevaluateUrgentMessages(req.io);

        res.json({ success: true });
    });
});



// ============================================================
// 🏭 CONTROL
// ============================================================

router.post('/control/take', authenticateToken, (req, res) => {
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

router.post('/control/toggle', authenticateToken, (req, res) => {
    const { index, value } = req.body;
    if (logicEngine.getFullState().controller === 'CABANE') return res.status(403).json({ error: "In Cabane Mode" });

    // Validate Permissions
    const state = logicEngine.getFullState();
    if (state.controller === 'SERVER' || state.currentUser !== req.user.username) {
        return res.status(403).json({ error: "Not active controller" });
    }

    logicEngine.toggleSwitch(index, value, req.user.username);
    logAction(req.io, req.user.id, req.user.username, 'SWITCH', `Toggled Switch ${index} ${value ? 'ON' : 'OFF'}`);
    res.json({ success: true });
});

// ============================================================
// 💬 MESSAGING SYSTEM (UPDATED)
// ============================================================

// GET MESSAGES (Pagination Support)
router.get('/messages', authenticateToken, (req, res) => {
    const { type, targetId } = req.query;
    const userId = req.user.id;

    // Pagination Params (Default 50)
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    let sql = `
    SELECT m.*, 
      u.username as sender,
      g.name as group_name,
      r.username as recipient_name,
      CASE WHEN mr.read_at IS NOT NULL THEN 1 ELSE 0 END as is_read_by_me,
      CASE WHEN mua.ack_at IS NOT NULL THEN 1 ELSE 0 END as is_ack_by_me
    FROM messages m 
    JOIN users u ON m.sender_id = u.id 
    LEFT JOIN groups g ON m.group_id = g.id
    LEFT JOIN users r ON m.recipient_id = r.id
    LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = ?
    LEFT JOIN message_urgency_acks mua ON m.id = mua.message_id AND mua.user_id = ?
    WHERE 
  `;

    let params = [userId, userId];

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
        // Default Feed
        sql += `(m.recipient_id IS NULL AND m.group_id IS NULL) 
            OR (m.recipient_id = ? OR m.sender_id = ?) 
            OR (m.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?))`;
        params.push(userId, userId, userId);
    }

    // Apply Pagination
    sql += ` ORDER BY m.timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        // Return reversed so they appear chronological (Oldest -> Newest)
        res.json(rows.reverse());
    });
});

// POST: Mark Read (Per User)
router.post('/messages/read', authenticateToken, (req, res) => {
    const { messageIds } = req.body;
    if (!messageIds || messageIds.length === 0) return res.json({ success: true });

    const userId = req.user.id;

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)");
        messageIds.forEach(msgId => stmt.run(msgId, userId));
        stmt.finalize();
        db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: "Update failed" });
            // Emit event so frontend updates badges instantly
            if (req.io) req.io.emit('MESSAGES_READ', { userId, messageIds });
            res.json({ success: true });
        });
    });
});

// POST: Create Message (With Echo)
router.post('/messages', authenticateToken, (req, res) => {
    const { content, recipientId, groupId, priority, tempId } = req.body;
    const rId = recipientId || null;
    const gId = groupId || null;

    // ✅ FIX 1: Generate Master Timestamp here (ISO 8601 UTC)
    const masterTimestamp = new Date().toISOString();

    // ✅ FIX 2: Explicitly insert this timestamp into DB
    const stmt = db.prepare("INSERT INTO messages (sender_id, recipient_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, ?, ?, ?)");

    stmt.run(req.user.id, rId, gId, content, priority || 'NORMAL', masterTimestamp, function (err) {
        if (err) return res.status(500).json({ error: "Send failed" });

        if (req.io) {
            req.io.emit('NEW_MESSAGE', {
                id: this.lastID,
                tempId: tempId,
                timestamp: masterTimestamp, // ✅ Send EXACT same string to socket
                sender_id: req.user.id,
                sender: req.user.username,
                recipient_id: rId,
                group_id: gId,
                content,
                priority,
                is_read_by_me: 0,
                is_ack_by_me: 0
            });
        }
        res.json({ success: true, id: this.lastID });
    });
    stmt.finalize();
});

// POST: Acknowledge/Downgrade Urgency
router.post('/messages/downgrade', authenticateToken, (req, res) => {
    const { messageId } = req.body;
    const userId = req.user.id;

    // 1. Mark as Acked by this user
    db.run("INSERT OR IGNORE INTO message_urgency_acks (message_id, user_id) VALUES (?, ?)",
        [messageId, userId],
        function (err) {
            if (err) return res.status(500).json({ error: "Update failed" });

            // 2. CHECK IF ALL RECIPIENTS HAVE ACKED
            // Logic:
            // A. Get message info (Recipient/Group/Global)
            // B. Count total target users
            // C. Count total acks

            const sqlCheck = `
                SELECT m.id, m.sender_id, m.recipient_id, m.group_id, m.priority,
                       (SELECT COUNT(*) FROM message_urgency_acks WHERE message_id = m.id) as ack_count,
                       (SELECT COUNT(*) FROM group_members WHERE group_id = m.group_id) as group_count,
                       (SELECT COUNT(*) FROM users WHERE status='ACTIVE') as global_count
                FROM messages m WHERE m.id = ?
            `;

            db.get(sqlCheck, [messageId], (err, row) => {
                if (!row) return res.json({ success: true }); // Should not happen

                let targetCount = 0;
                let isDowngradeNeeded = false;

                if (row.recipient_id) {
                    targetCount = 1; // Just the recipient
                } else if (row.group_id) {
                    // Group Size - 1 (Sender doesn't ack)
                    targetCount = row.group_count - 1;
                } else {
                    // Global (All Active Users - 1)
                    targetCount = row.global_count - 1;
                }

                // If everyone acked, downgrade!
                // Note: ack_count includes sender if they acked? No, sender UI doesn't usually allow acking own msg.
                // Assuming normal flow:
                if (row.ack_count >= targetCount) {
                    isDowngradeNeeded = true;
                }

                if (isDowngradeNeeded && row.priority === 'URGENT') {
                    db.run("UPDATE messages SET priority = 'NORMAL' WHERE id = ?", [messageId], () => {
                        if (req.io) {
                            req.io.emit('UPDATE_MESSAGE', { id: messageId, priority: 'NORMAL' });
                        }
                    });
                }
            });

            res.json({ success: true });
        }
    );
});

// POST: Sender Cancels Urgency
router.post('/messages/cancel-urgency', authenticateToken, (req, res) => {
    const { messageId } = req.body;
    const userId = req.user.id;

    // Verify ownership and update
    db.run(
        "UPDATE messages SET priority = 'NORMAL' WHERE id = ? AND sender_id = ?",
        [messageId, userId],
        function (err) {
            if (err) return res.status(500).json({ error: "DB Error" });
            if (this.changes === 0) return res.status(403).json({ error: "Not sender or msg not found" });

            // Emit Global Update (Closes FlashViewers for everyone)
            if (req.io) {
                req.io.emit('UPDATE_MESSAGE', { id: messageId, priority: 'NORMAL' });
            }
            res.json({ success: true });
        }
    );
});

// ... Group Routes (Create, Leave) ...
router.get('/users/directory', authenticateToken, (req, res) => {
    db.all("SELECT id, username, role, status FROM users WHERE status='ACTIVE'", [], (err, rows) => res.json(rows));
});

router.get('/conversations', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const conversations = [];
    conversations.push({ type: 'GLOBAL', name: 'Global Chat', id: 'global' });
    conversations.push({ type: 'NOTES', name: 'My Notes', id: 'notes' });

    const groupSql = `SELECT g.id, g.name, GROUP_CONCAT(u.username, ', ') as members FROM groups g JOIN group_members gm ON g.id = gm.group_id JOIN users u ON gm.user_id = u.id WHERE g.id IN (SELECT group_id FROM group_members WHERE user_id = ?) GROUP BY g.id`;
    db.all(groupSql, [userId], (err, groups) => {
        if (groups) groups.forEach(g => conversations.push({ type: 'GROUP', name: g.name, id: g.id, members: g.members }));

        const dmSql = `SELECT DISTINCT u.id, u.username FROM users u JOIN messages m ON (m.sender_id = u.id AND m.recipient_id = ?) OR (m.recipient_id = u.id AND m.sender_id = ?) WHERE u.id != ?`;
        db.all(dmSql, [userId, userId, userId], (err, users) => {
            if (users) users.forEach(u => conversations.push({ type: 'DM', name: u.username, id: u.id }));
            res.json(conversations);
        });
    });
});

router.post('/api/messages/delete', authenticateToken, (req, res) => {
    const { messageId } = req.body;
    db.get("SELECT sender_id FROM messages WHERE id = ?", [messageId], (err, row) => {
        if (!row) return res.status(404).json();
        if (row.sender_id !== req.user.id) return res.status(403).json();
        db.run("DELETE FROM messages WHERE id = ?", [messageId], (err) => {
            if (req.io) req.io.emit('DELETE_MESSAGE', { id: messageId });
            res.json({ success: true });
        });
    });
});

// Group creation/leave endpoints...
router.post('/groups', authenticateToken, (req, res) => {
    const { name, memberIds } = req.body;
    db.run("INSERT INTO groups (name) VALUES (?)", [name], function () {
        const gid = this.lastID;
        db.run("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)", [gid, req.user.id]);
        if (memberIds) memberIds.forEach(uid => db.run("INSERT INTO group_members VALUES (?, ?)", [gid, uid]));
        res.json({ success: true });
    });
});

router.post('/groups/leave', authenticateToken, (req, res) => {
    const { groupId } = req.body;
    db.run("DELETE FROM group_members WHERE group_id=? AND user_id=?", [groupId, req.user.id], () => {
        // ✅ Trigger Check
        reevaluateUrgentMessages(req.io);
        res.json({ success: true });
    });
});


// ============================================================
// 🧹 HELPERS
// ============================================================

// Re-evaluates ALL active urgent messages to see if they can be downgraded
// (Run this after a user is deleted or leaves a group)
const reevaluateUrgentMessages = (io) => {
    const sql = `SELECT id, recipient_id, group_id, sender_id FROM messages WHERE priority = 'URGENT'`;

    db.all(sql, [], (err, messages) => {
        if (err || !messages || messages.length === 0) return;

        messages.forEach(msg => {
            // Define who still NEEDS to ack 
            // Logic: Count (Target Users) MINUS (Users who already acked)
            let pendingSql = "";
            let params = [];

            if (msg.recipient_id) {
                // DM: Check if the specific recipient is pending
                // (If recipient was deleted, count will be 0)
                pendingSql = `
                    SELECT COUNT(*) as pending 
                    FROM users 
                    WHERE id = ? 
                    AND id NOT IN (SELECT user_id FROM message_urgency_acks WHERE message_id = ?)
                `;
                params = [msg.recipient_id, msg.id];
            }
            else if (msg.group_id) {
                // Group: Active Members excluding Sender and Ackers
                pendingSql = `
                    SELECT COUNT(*) as pending 
                    FROM group_members gm
                    JOIN users u ON gm.user_id = u.id
                    WHERE gm.group_id = ? 
                    AND u.status = 'ACTIVE'
                    AND u.id != ?
                    AND u.id NOT IN (SELECT user_id FROM message_urgency_acks WHERE message_id = ?)
                `;
                params = [msg.group_id, msg.sender_id, msg.id];
            }
            else {
                // Global: All Active Users excluding Sender and Ackers
                pendingSql = `
                    SELECT COUNT(*) as pending 
                    FROM users 
                    WHERE status = 'ACTIVE'
                    AND id != ?
                    AND id NOT IN (SELECT user_id FROM message_urgency_acks WHERE message_id = ?)
                `;
                params = [msg.sender_id, msg.id];
            }

            db.get(pendingSql, params, (err, row) => {
                if (!row) return;

                // If NO ONE is pending (count is 0), the message is resolved
                if (row.pending === 0) {
                    console.log(`[Urgency] Auto-downgrading Message ${msg.id} (All recipients acknowledged or deleted)`);

                    db.run("UPDATE messages SET priority = 'NORMAL' WHERE id = ?", [msg.id], () => {
                        if (io) io.emit('UPDATE_MESSAGE', { id: msg.id, priority: 'NORMAL' });
                    });
                }
            });
        });
    });
};

module.exports = router;