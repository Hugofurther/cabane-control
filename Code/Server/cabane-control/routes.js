// ============================================================
// 🛣️ API ROUTES - FINAL PRODUCTION (v5 Notes & Metadata)
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
const checkDiskSpace = require('check-disk-space').default;

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

// ------------------------------------------------------------
// 📊 SYSTEM STATUS (Disk Usage)
// ------------------------------------------------------------
router.get('/system/status', authenticateToken, async (req, res) => {
    try {
        const space = await checkDiskSpace('/');
        const percent = Math.round(((space.size - space.free) / space.size) * 100);
        res.json({
            diskUsage: `${percent}%`,
            free: space.free,
            size: space.size
        });
    } catch (e) {
        console.error("[System] Disk check failed:", e);
        res.json({ diskUsage: 'Unknown', free: 0, size: 0 });
    }
});

// ============================================================
// 📜 LOGS (The Missing Route)
// ============================================================
router.get('/logs', authenticateToken, (req, res) => {
    // Check permission
    db.get("SELECT role, can_view_logs FROM users WHERE id = ?", [req.user.id], (err, user) => {
        if (!user) return res.status(403).json({ error: "Access denied" });
        if (user.role !== 'ADMIN' && !user.can_view_logs) return res.status(403).json({ error: "Access denied" });

        // Limit query parameter
        const limit = parseInt(req.query.limit) || 100;

        // Fetch logs with usernames
        db.all(`SELECT l.*, u.username FROM logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.timestamp DESC LIMIT ?`, [limit], (err, rows) => {
            if (err) return res.status(500).json({ error: "DB Error" });
            res.json(rows);
        });
    });
});

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

        // Respect session setting
        const expiresIn = userSettings.tokenExpiration || '60d';

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn }
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

                    // Weather Reload
                    if (settings.weather_locations || settings.weather_update_interval || settings.weather_api_key) {
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

// ✅ NEW: Transfer Global Admin Rights
router.post('/users/transfer-admin', authenticateToken, requireAdmin, (req, res) => {
    const currentAdminId = req.user.id;
    const { newAdminId } = req.body;

    if (String(currentAdminId) === String(newAdminId)) {
        return res.status(400).json({ error: "Cannot transfer to yourself." });
    }

    const timestamp = new Date().toISOString();

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // 1. Promote New Admin
        db.run("UPDATE users SET role = 'ADMIN', can_control = 1, can_view_logs = 1 WHERE id = ?", [newAdminId]);

        // 2. Demote Old Admin
        db.run("UPDATE users SET role = 'USER' WHERE id = ?", [currentAdminId]);

        // 3. Log it
        db.run("INSERT INTO logs (user_id, type, message, timestamp) VALUES (?, 'SYSTEM', 'Transferred Global Admin Rights', ?)",
            [currentAdminId, timestamp]);

        // 4. ✅ SEND FLASH MESSAGE TO NEW ADMIN
        const alertMsg = "👑 SYSTEM NOTICE\n\nYou have been promoted to Global Administrator.\nYou now have full control over the system.";
        db.run("INSERT INTO messages (sender_id, recipient_id, content, priority, timestamp) VALUES (?, ?, ?, 'URGENT', ?)",
            [currentAdminId, newAdminId, alertMsg, timestamp],
            function (err) {
                if (!err && req.io) {
                    req.io.emit('NEW_MESSAGE', {
                        id: this.lastID,
                        sender_id: currentAdminId,
                        sender: 'SYSTEM',
                        recipient_id: newAdminId,
                        group_id: null,
                        content: alertMsg,
                        priority: 'URGENT',
                        timestamp: timestamp,
                        is_read_by_me: 0,
                        is_ack_by_me: 0
                    });
                }
            }
        );

        db.run("COMMIT", (err) => {
            if (err) {
                console.error("Transfer failed", err);
                return res.status(500).json({ error: "Database transaction failed." });
            }

            // 5. Notify Clients to refresh permissions
            req.io.emit('USER_PERMISSION_UPDATE', { userId: currentAdminId, key: 'role', value: 'USER' });
            req.io.emit('USER_PERMISSION_UPDATE', { userId: newAdminId, key: 'role', value: 'ADMIN' });
            req.io.emit('USER_PERMISSION_UPDATE', { userId: newAdminId, key: 'can_control', value: 1 });
            req.io.emit('USER_PERMISSION_UPDATE', { userId: newAdminId, key: 'can_view_logs', value: 1 });

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
    const newVal = value ? 1 : 0;

    db.run(`UPDATE users SET ${col} = ? WHERE id = ?`, [newVal, userId], (err) => {
        if (err) return res.status(500).json({ error: "DB Error" });

        // Broadcast Permission Update
        req.io.emit('USER_PERMISSION_UPDATE', {
            userId,
            key: col,
            value: newVal
        });

        res.json({ success: true });
    });
});

router.post('/users/delete', authenticateToken, requireAdmin, (req, res) => {
    const { userId } = req.body;
    if (userId === req.user.id) return res.status(400).json({ error: "Cannot delete self" });

    db.run("DELETE FROM users WHERE id = ?", [userId], function (err) {
        if (this.changes === 0) return res.status(404).json();
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
// 💬 MESSAGING SYSTEM
// ============================================================

router.get('/messages', authenticateToken, (req, res) => {
    const { type, targetId } = req.query;
    const userId = req.user.id;
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

    sql += ` ORDER BY m.timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows.reverse());
    });
});

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
            if (req.io) req.io.emit('MESSAGES_READ', { userId, messageIds });
            res.json({ success: true });
        });
    });
});

router.post('/messages', authenticateToken, (req, res) => {
    const { content, recipientId, groupId, priority, tempId } = req.body;
    const rId = recipientId || null;
    const gId = groupId || null;
    const masterTimestamp = new Date().toISOString();

    const stmt = db.prepare("INSERT INTO messages (sender_id, recipient_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, ?, ?, ?)");

    stmt.run(req.user.id, rId, gId, content, priority || 'NORMAL', masterTimestamp, function (err) {
        if (err) return res.status(500).json({ error: "Send failed" });

        if (req.io) {
            req.io.emit('NEW_MESSAGE', {
                id: this.lastID,
                tempId: tempId,
                timestamp: masterTimestamp,
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

router.post('/messages/downgrade', authenticateToken, (req, res) => {
    const { messageId } = req.body;
    const userId = req.user.id;

    db.run("INSERT OR IGNORE INTO message_urgency_acks (message_id, user_id) VALUES (?, ?)", [messageId, userId], function (err) {
        if (err) return res.status(500).json({ error: "Update failed" });

        const sqlCheck = `
            SELECT m.id, m.sender_id, m.recipient_id, m.group_id, m.priority,
                   (SELECT COUNT(*) FROM message_urgency_acks WHERE message_id = m.id) as ack_count,
                   (SELECT COUNT(*) FROM group_members WHERE group_id = m.group_id) as group_count,
                   (SELECT COUNT(*) FROM users WHERE status='ACTIVE') as global_count
            FROM messages m WHERE m.id = ?
        `;

        db.get(sqlCheck, [messageId], (err, row) => {
            if (!row) return res.json({ success: true });

            let targetCount = 0;
            let isDowngradeNeeded = false;

            if (row.recipient_id) targetCount = 1;
            else if (row.group_id) targetCount = row.group_count - 1;
            else targetCount = row.global_count - 1;

            if (row.ack_count >= targetCount) isDowngradeNeeded = true;

            if (isDowngradeNeeded && row.priority === 'URGENT') {
                db.run("UPDATE messages SET priority = 'NORMAL' WHERE id = ?", [messageId], () => {
                    if (req.io) req.io.emit('UPDATE_MESSAGE', { id: messageId, priority: 'NORMAL' });
                });
            }
        });
        res.json({ success: true });
    });
});

router.post('/messages/cancel-urgency', authenticateToken, (req, res) => {
    const { messageId } = req.body;
    const userId = req.user.id;
    db.run("UPDATE messages SET priority = 'NORMAL' WHERE id = ? AND sender_id = ?", [messageId, userId], function (err) {
        if (err) return res.status(500).json({ error: "DB Error" });
        if (this.changes === 0) return res.status(403).json({ error: "Not sender or msg not found" });
        if (req.io) req.io.emit('UPDATE_MESSAGE', { id: messageId, priority: 'NORMAL' });
        res.json({ success: true });
    });
});

// ... Group Routes (Directory, Conversations, Delete, Create, Rename, Members, Transfer, Leave) ...
router.get('/users/directory', authenticateToken, (req, res) => {
    db.all("SELECT id, username, role, status FROM users WHERE status='ACTIVE'", [], (err, rows) => res.json(rows));
});

router.get('/conversations', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const conversations = [];
    conversations.push({ type: 'GLOBAL', name: 'Global Chat', id: 'global' });
    conversations.push({ type: 'NOTES', name: 'My Notes', id: 'notes' });

    const groupSql = `
        SELECT g.id, g.name, g.created_by, GROUP_CONCAT(u.username, ', ') as members 
        FROM groups g 
        JOIN group_members gm ON g.id = gm.group_id 
        JOIN users u ON gm.user_id = u.id 
        WHERE g.id IN (SELECT group_id FROM group_members WHERE user_id = ?) 
        GROUP BY g.id
    `;

    db.all(groupSql, [userId], (err, groups) => {
        if (groups) groups.forEach(g => conversations.push({ type: 'GROUP', name: g.name, id: g.id, members: g.members, created_by: g.created_by }));

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

router.post('/groups', authenticateToken, async (req, res) => {
    const { name, memberIds } = req.body;
    const creatorId = req.user.id;
    const allMemberIds = [...new Set([...memberIds, creatorId])];

    // Check constraint
    const placeholders = allMemberIds.map(() => '?').join(',');
    const checkSql = `SELECT u.username FROM users u JOIN group_members gm ON u.id = gm.user_id JOIN groups g ON gm.group_id = g.id WHERE g.name = ? AND u.id IN (${placeholders})`;

    db.get(checkSql, [name, ...allMemberIds], (err, row) => {
        if (row) return res.status(409).json({ error: `User '${row.username}' is already in a group named '${name}'.` });

        db.run("INSERT INTO groups (name, created_by) VALUES (?, ?)", [name, creatorId], function (err) {
            if (err) return res.status(500).json({ error: "DB Error" });
            const groupId = this.lastID;
            const insertMember = db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)");
            allMemberIds.forEach(uid => insertMember.run(groupId, uid));
            insertMember.finalize();

            const sysMsg = `Group "${name}" created by ${req.user.username}`;
            db.run("INSERT INTO messages (sender_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, 'URGENT', ?)",
                [creatorId, groupId, sysMsg, new Date().toISOString()],
                function () {
                    if (req.io) {
                        req.io.emit('NEW_MESSAGE', { id: this.lastID, sender_id: creatorId, sender: 'SYSTEM', group_id: groupId, content: sysMsg, priority: 'URGENT', timestamp: new Date().toISOString() });
                        allMemberIds.forEach(uid => req.io.emit('GROUP_MEMBERSHIP_UPDATE', { targetUserId: uid, groupId: groupId, action: 'ADD' }));
                    }
                }
            );
            res.json({ success: true, groupId });
        });
    });
});

router.post('/groups/:id/rename', authenticateToken, (req, res) => {
    const groupId = req.params.id;
    const { newName } = req.body;
    const userId = req.user.id;

    db.get("SELECT * FROM groups WHERE id = ?", [groupId], (err, group) => {
        if (!group) return res.status(404).json({ error: "Group not found" });
        if (group.created_by !== userId && req.user.role !== 'ADMIN') return res.status(403).json({ error: "Permission denied." });

        const checkSql = `SELECT u.username FROM users u JOIN group_members gm ON u.id = gm.user_id JOIN groups g ON gm.group_id = g.id WHERE g.name = ? AND g.id != ? AND u.id IN (SELECT user_id FROM group_members WHERE group_id = ?)`;
        db.get(checkSql, [newName, groupId, groupId], (err, conflict) => {
            if (conflict) return res.status(409).json({ error: `User '${conflict.username}' is already in another group named '${newName}'.` });

            db.run("UPDATE groups SET name = ? WHERE id = ?", [newName, groupId], () => {
                const alertMsg = `⚠️ GROUP RENAMED\n\nThis group has been renamed from "${group.name}" to "${newName}".`;
                db.run("INSERT INTO messages (sender_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, 'URGENT', ?)", [userId, groupId, alertMsg, new Date().toISOString()], function () {
                    if (req.io) req.io.emit('NEW_MESSAGE', { id: this.lastID, sender_id: userId, sender: 'SYSTEM', group_id: groupId, content: alertMsg, priority: 'URGENT', timestamp: new Date().toISOString() });
                });
                res.json({ success: true });
            });
        });
    });
});

router.post('/groups/:id/members', authenticateToken, (req, res) => {
    const groupId = req.params.id;
    const { targetUserId, action, notificationType } = req.body;
    const userId = req.user.id;

    db.get("SELECT * FROM groups WHERE id = ?", [groupId], (err, group) => {
        if (!group) return res.status(404).json();
        if (group.created_by !== userId && req.user.role !== 'ADMIN') return res.status(403).json({ error: "Permission denied" });

        db.get("SELECT username FROM users WHERE id = ?", [targetUserId], (err, targetUser) => {
            if (!targetUser) return res.status(404).json({ error: "Target user not found" });
            const targetName = targetUser.username;

            if (action === 'ADD') {
                const checkSql = `SELECT 1 FROM groups g JOIN group_members gm ON g.id = gm.group_id WHERE g.name = ? AND gm.user_id = ?`;
                db.get(checkSql, [group.name, targetUserId], (err, conflict) => {
                    if (conflict) return res.status(409).json({ error: "User already in a group with this name." });
                    db.run("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)", [groupId, targetUserId], function () {
                        if (this.changes > 0) {
                            handleMemberNotification(req.io, userId, groupId, targetUserId, 'ADDED', notificationType, group.name, targetName);
                            req.io.emit('GROUP_MEMBERSHIP_UPDATE', { targetUserId, groupId, action: 'ADD' });
                        }
                        res.json({ success: true });
                    });
                });
            } else if (action === 'REMOVE') {
                db.run("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, targetUserId], function () {
                    if (this.changes > 0) {
                        handleMemberNotification(req.io, userId, groupId, targetUserId, 'REMOVED', notificationType, group.name, targetName);
                        reevaluateUrgentMessages(req.io);
                        req.io.emit('GROUP_MEMBERSHIP_UPDATE', { targetUserId, groupId, action: 'REMOVE' });
                    }
                    res.json({ success: true });
                });
            }
        });
    });
});

router.post('/groups/:id/delete', authenticateToken, (req, res) => {
    const groupId = req.params.id;
    const userId = req.user.id;
    db.get("SELECT * FROM groups WHERE id = ?", [groupId], (err, group) => {
        if (!group) return res.status(404).json();
        if (group.created_by !== userId && req.user.role !== 'ADMIN') return res.status(403).json({ error: "Permission denied" });
        db.run("DELETE FROM groups WHERE id = ?", [groupId], () => {
            reevaluateUrgentMessages(req.io);
            req.io.emit('GROUP_DELETED', { groupId });
            res.json({ success: true });
        });
    });
});

router.post('/groups/:id/transfer', authenticateToken, (req, res) => {
    const groupId = req.params.id;
    const { newAdminId } = req.body;
    const userId = req.user.id;
    db.get("SELECT * FROM groups WHERE id = ?", [groupId], (err, group) => {
        if (!group) return res.status(404).json();
        if (group.created_by !== userId && req.user.role !== 'ADMIN') return res.status(403).json({ error: "Permission denied" });
        db.get("SELECT username FROM users WHERE id = ?", [newAdminId], (err, newAdmin) => {
            if (!newAdmin) return res.status(404).json({ error: "New admin not found" });
            db.run("UPDATE groups SET created_by = ? WHERE id = ?", [newAdminId, groupId], () => {
                const alertMsg = `⚠️ ADMIN TRANSFER\n\nOwnership of this group has been transferred to ${newAdmin.username}.`;
                db.run("INSERT INTO messages (sender_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, 'URGENT', ?)", [userId, groupId, alertMsg, new Date().toISOString()], function () {
                    if (req.io) req.io.emit('NEW_MESSAGE', { id: this.lastID, sender_id: userId, sender: 'SYSTEM', group_id: groupId, content: alertMsg, priority: 'URGENT', timestamp: new Date().toISOString() });
                });
                res.json({ success: true });
            });
        });
    });
});

router.post('/groups/leave', authenticateToken, (req, res) => {
    const { groupId } = req.body;
    db.run("DELETE FROM group_members WHERE group_id=? AND user_id=?", [groupId, req.user.id], () => {
        reevaluateUrgentMessages(req.io);
        res.json({ success: true });
    });
});

// ============================================================
// 📝 NOTES SYSTEM (Real-time Updated)
// ============================================================

// Helper to fetch single note with full metadata
const fetchNoteAndEmit = (noteId, io) => {
    const sql = `
        SELECT n.*, u.username as creator_name,
        GROUP_CONCAT(s.username, ', ') as shared_with_names
        FROM notes n
        JOIN users u ON n.creator_id = u.id
        LEFT JOIN note_shares ns ON n.id = ns.note_id
        LEFT JOIN users s ON ns.user_id = s.id
        WHERE n.id = ?
        GROUP BY n.id
    `;
    db.get(sql, [noteId], (err, note) => {
        if (!err && note && io) {
            io.emit('NOTE_UPDATE', note); // ⚡ Real-time update
        }
    });
};

// GET NOTES (Owned + Shared)
router.get('/notes', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const sql = `
        SELECT n.*, u.username as creator_name,
        CASE WHEN n.creator_id = ? THEN 1 ELSE 0 END as is_owner,
        GROUP_CONCAT(s.username, ', ') as shared_with_names
        FROM notes n
        JOIN users u ON n.creator_id = u.id
        LEFT JOIN note_shares ns ON n.id = ns.note_id
        LEFT JOIN users s ON ns.user_id = s.id
        WHERE n.creator_id = ? 
           OR n.id IN (SELECT note_id FROM note_shares WHERE user_id = ?)
        GROUP BY n.id
        ORDER BY n.updated_at DESC
    `;
    db.all(sql, [userId, userId, userId], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows);
    });
});

// CREATE NOTE
router.post('/notes', authenticateToken, (req, res) => {
    const { title, content } = req.body;
    const creatorId = req.user.id;
    const timestamp = new Date().toISOString();
    const history = JSON.stringify([{ action: 'CREATED', user: req.user.username, timestamp }]);

    db.run("INSERT INTO notes (creator_id, title, content, share_history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [creatorId, title, content, history, timestamp, timestamp],
        function (err) {
            if (err) return res.status(500).json({ error: "Create failed" });
            fetchNoteAndEmit(this.lastID, req.io);
            res.json({ success: true, id: this.lastID });
        }
    );
});

// UPDATE NOTE
router.put('/notes/:id', authenticateToken, (req, res) => {
    const { title, content } = req.body;
    const noteId = req.params.id;
    const userId = req.user.id;
    const timestamp = new Date().toISOString();

    db.run("UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ? AND creator_id = ?",
        [title, content, timestamp, noteId, userId],
        function (err) {
            if (err) return res.status(500).json({ error: "Update failed" });
            if (this.changes === 0) return res.status(403).json({ error: "Not owner or not found" });
            fetchNoteAndEmit(noteId, req.io);
            res.json({ success: true });
        }
    );
});

// DELETE NOTE
router.delete('/notes/:id', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const userId = req.user.id;

    db.get("SELECT creator_id FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json({ error: "Note not found" });

        if (note.creator_id === userId) {
            db.run("DELETE FROM notes WHERE id = ?", [noteId], () => {
                req.io.emit('NOTE_DELETE', { id: noteId });
                res.json({ success: true });
            });
        } else {
            db.run("DELETE FROM note_shares WHERE note_id = ? AND user_id = ?", [noteId, userId], () => {
                // Viewer removed themselves, update the "Shared With" list for others
                fetchNoteAndEmit(noteId, req.io);
                res.json({ success: true });
            });
        }
    });
});

// SHARE NOTE
router.post('/notes/:id/share', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const { targetUserId } = req.body;
    const userId = req.user.id;

    db.get("SELECT * FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json();

        // Check Permissions (Owner OR Existing Share)
        const checkAccessSql = `SELECT 1 FROM note_shares WHERE note_id = ? AND user_id = ?`;
        db.get(checkAccessSql, [noteId, userId], (err, share) => {
            if (note.creator_id !== userId && !share) return res.status(403).json({ error: "Permission denied" });

            db.run("INSERT OR IGNORE INTO note_shares (note_id, user_id) VALUES (?, ?)", [noteId, targetUserId], function () {
                // Update History
                let history = [];
                try { history = JSON.parse(note.share_history || '[]'); } catch (e) { }

                // Add Re-Share or Share Action
                const action = (note.creator_id === userId) ? 'SHARED' : 'RE-SHARED';
                history.push({ action, user: req.user.username, timestamp: new Date().toISOString() });

                db.run("UPDATE notes SET share_history = ? WHERE id = ?", [JSON.stringify(history), noteId]);

                if (this.changes > 0 && req.io) {
                    const sysMsg = `📄 SHARED NOTE: "${note.title}"\nHas been shared with you by ${req.user.username}. Check your Notes tab.`;
                    const timestamp = new Date().toISOString();
                    db.run("INSERT INTO messages (sender_id, recipient_id, content, priority, timestamp) VALUES (?, ?, ?, 'NORMAL', ?)", [userId, targetUserId, sysMsg, timestamp], () => {
                        req.io.emit('NEW_MESSAGE', { id: this.lastID, sender_id: userId, sender: 'SYSTEM', recipient_id: targetUserId, content: sysMsg, priority: 'NORMAL', timestamp, is_read_by_me: 0, is_ack_by_me: 0 });
                    });
                }

                // ✅ EMIT UPDATE
                fetchNoteAndEmit(noteId, req.io);
                res.json({ success: true });
            });
        });
    });
});

// COPY NOTE
router.post('/notes/:id/copy', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const userId = req.user.id;
    const timestamp = new Date().toISOString();

    db.get("SELECT title, content, creator_id FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json();
        db.get("SELECT username FROM users WHERE id = ?", [note.creator_id], (err, creator) => {
            const creatorName = creator ? creator.username : "Unknown";
            const newContent = `${note.content}`;
            const history = JSON.stringify([{ action: 'COPIED', user: req.user.username, from: creatorName, timestamp }]);

            db.run("INSERT INTO notes (creator_id, title, content, share_history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                [userId, note.title + " (Copy)", newContent, history, timestamp, timestamp],
                function () {
                    fetchNoteAndEmit(this.lastID, req.io);
                    res.json({ success: true, id: this.lastID });
                }
            );
        });
    });
});

// FLASH NOTE
router.post('/notes/:id/flash', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const { targetUserId } = req.body;
    const userId = req.user.id;

    db.get("SELECT * FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json();

        // 1. Ensure receiver has access
        db.run("INSERT OR IGNORE INTO note_shares (note_id, user_id) VALUES (?, ?)", [noteId, targetUserId]);

        // 2. Update History
        let history = [];
        try { history = JSON.parse(note.share_history || '[]'); } catch (e) { }
        const action = (note.creator_id === userId) ? 'FLASHED' : 'RE-FLASHED';
        history.push({ action, user: req.user.username, timestamp: new Date().toISOString() });

        db.run("UPDATE notes SET share_history = ? WHERE id = ?", [JSON.stringify(history), noteId]);

        // 3. Emit Updates
        fetchNoteAndEmit(noteId, req.io);

        // 4. Send Message
        const timestamp = new Date().toISOString();
        const payload = JSON.stringify({
            type: 'NOTE_FLASH',
            noteId: note.id,
            title: note.title,
            content: note.content,
            sharedBy: req.user.username,
            shareHistory: history,
            originalCreatorId: note.creator_id
        });

        db.run("INSERT INTO messages (sender_id, recipient_id, content, priority, timestamp) VALUES (?, ?, ?, 'URGENT', ?)", [userId, targetUserId, payload, timestamp], function () {
            if (req.io) {
                req.io.emit('NEW_MESSAGE', { id: this.lastID, sender_id: userId, sender: req.user.username, recipient_id: targetUserId, group_id: null, content: payload, priority: 'URGENT', timestamp, is_read_by_me: 0, is_ack_by_me: 0 });
            }
            res.json({ success: true });
        });
    });
});


// Helpers
const reevaluateUrgentMessages = (io) => {
    const sql = `SELECT id, recipient_id, group_id, sender_id FROM messages WHERE priority = 'URGENT'`;
    db.all(sql, [], (err, messages) => {
        if (err || !messages) return;
        messages.forEach(msg => {
            let pendingSql = "";
            let params = [];
            if (msg.recipient_id) {
                pendingSql = `SELECT COUNT(*) as pending FROM users WHERE id = ? AND id NOT IN (SELECT user_id FROM message_urgency_acks WHERE message_id = ?)`;
                params = [msg.recipient_id, msg.id];
            } else if (msg.group_id) {
                pendingSql = `SELECT COUNT(*) as pending FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ? AND u.status = 'ACTIVE' AND u.id != ? AND u.id NOT IN (SELECT user_id FROM message_urgency_acks WHERE message_id = ?)`;
                params = [msg.group_id, msg.sender_id, msg.id];
            } else {
                pendingSql = `SELECT COUNT(*) as pending FROM users WHERE status = 'ACTIVE' AND id != ? AND id NOT IN (SELECT user_id FROM message_urgency_acks WHERE message_id = ?)`;
                params = [msg.sender_id, msg.id];
            }
            db.get(pendingSql, params, (err, row) => {
                if (!row) return;
                if (row.pending === 0) {
                    db.run("UPDATE messages SET priority = 'NORMAL' WHERE id = ?", [msg.id], () => {
                        if (io) io.emit('UPDATE_MESSAGE', { id: msg.id, priority: 'NORMAL' });
                    });
                }
            });
        });
    });
};

function handleMemberNotification(io, adminId, groupId, targetId, action, type, groupName, targetName) {
    if (type === 'QUIET') return;
    const timestamp = new Date().toISOString();
    const priority = 'URGENT';
    let content = "";
    let recipientId = null;
    let targetGroupId = null;

    if (type === 'PRIVATE') {
        recipientId = targetId;
        content = `NOTICE: You have been ${action} ${action === 'ADDED' ? 'to' : 'from'} the group "${groupName}".`;
    } else if (type === 'PUBLIC') {
        targetGroupId = groupId;
        content = `GROUP UPDATE: User "${targetName}" has been ${action}.`;
    }

    const insertMsg = (rId, gId, txt) => {
        db.run("INSERT INTO messages (sender_id, recipient_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, ?, ?, ?)", [adminId, rId, gId, txt, priority, timestamp], function () {
            if (io) io.emit('NEW_MESSAGE', { id: this.lastID, sender_id: adminId, sender: 'SYSTEM', recipient_id: rId, group_id: gId, content: txt, priority, timestamp, is_read_by_me: 0, is_ack_by_me: 0 });
        });
    };
    insertMsg(recipientId, targetGroupId, content);
    if (type === 'PUBLIC' && action === 'REMOVED') {
        const dmContent = `NOTICE: You have been REMOVED from the group "${groupName}" (Publicly).`;
        insertMsg(targetId, null, dmContent);
    }
}

module.exports = router;