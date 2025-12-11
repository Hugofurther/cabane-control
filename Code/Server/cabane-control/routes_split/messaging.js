const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const db = require('../db'); // ✅ Shared DB Connection

// ============================================================
// 📨 MESSAGING CORE
// ============================================================

// GET MESSAGES (Pagination + Filters)
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
        sql += `(m.recipient_id IS NULL AND m.group_id IS NULL) OR (m.recipient_id = ? OR m.sender_id = ?) OR (m.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?))`;
        params.push(userId, userId, userId);
    }

    sql += ` ORDER BY m.timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows.reverse());
    });
});

// POST MESSAGE
router.post('/messages', authenticateToken, (req, res) => {
    const { content, recipientId, groupId, priority, tempId } = req.body;
    const timestamp = new Date().toISOString();

    db.run("INSERT INTO messages (sender_id, recipient_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        [req.user.id, recipientId, groupId, content, priority || 'NORMAL', timestamp],
        function (err) {
            if (err) return res.status(500).json({ error: "Send failed" });

            if (req.io) {
                req.io.emit('NEW_MESSAGE', {
                    id: this.lastID,
                    tempId,
                    timestamp,
                    sender_id: req.user.id,
                    sender: req.user.username,
                    recipient_id: recipientId,
                    group_id: groupId,
                    content,
                    priority,
                    is_read_by_me: 0,
                    is_ack_by_me: 0
                });
            }
            res.json({ success: true, id: this.lastID });
        }
    );
});

// MARK READ
router.post('/messages/read', authenticateToken, (req, res) => {
    const { messageIds } = req.body;
    const userId = req.user.id;
    if (!messageIds || !messageIds.length) return res.json({ success: true });

    db.serialize(() => {
        db.run("BEGIN");
        const stmt = db.prepare("INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)");
        messageIds.forEach(id => stmt.run(id, userId));
        stmt.finalize();
        db.run("COMMIT", () => {
            if (req.io) req.io.emit('MESSAGES_READ', { userId, messageIds });
            res.json({ success: true });
        });
    });
});

// URGENCY CONTROL
router.post('/messages/downgrade', authenticateToken, (req, res) => {
    const { messageId } = req.body;
    const userId = req.user.id;

    db.run("INSERT OR IGNORE INTO message_urgency_acks (message_id, user_id) VALUES (?, ?)", [messageId, userId], function (err) {
        if (err) return res.status(500).json({ error: "Update failed" });

        // Check if everyone acked
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
            else if (row.group_id) targetCount = row.group_count - 1; // Exclude sender
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
    db.run("UPDATE messages SET priority = 'NORMAL' WHERE id = ? AND sender_id = ?", [messageId, req.user.id], function (err) {
        if (this.changes > 0 && req.io) req.io.emit('UPDATE_MESSAGE', { id: messageId, priority: 'NORMAL' });
        res.json({ success: true });
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

// ============================================================
// 👥 DIRECTORY & CONVERSATIONS
// ============================================================

router.get('/users/directory', authenticateToken, (req, res) => {
    db.all("SELECT id, username, role, status FROM users WHERE status='ACTIVE'", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows);
    });
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


// ============================================================
// 👥 GROUP MANAGEMENT
// ============================================================

// 1. CREATE GROUP
router.post('/groups', authenticateToken, async (req, res) => {
    const { name, memberIds } = req.body;
    const creatorId = req.user.id;
    const allMemberIds = [...new Set([...memberIds, creatorId])];
    const placeholders = allMemberIds.map(() => '?').join(',');

    db.get(`SELECT u.username FROM users u JOIN group_members gm ON u.id = gm.user_id JOIN groups g ON gm.group_id = g.id WHERE g.name = ? AND u.id IN (${placeholders})`, [name, ...allMemberIds], (err, row) => {
        if (row) return res.status(409).json({ error: `User '${row.username}' is already in a group named '${name}'.` });

        db.run("INSERT INTO groups (name, created_by) VALUES (?, ?)", [name, creatorId], function (err) {
            if (err) return res.status(500).json({ error: "DB Error" });
            const groupId = this.lastID;
            const insertMember = db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)");
            allMemberIds.forEach(uid => insertMember.run(groupId, uid));
            insertMember.finalize();

            const sysMsg = `Group "${name}" created by ${req.user.username}`;
            db.run("INSERT INTO messages (sender_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, 'URGENT', ?)", [creatorId, groupId, sysMsg, new Date().toISOString()], function () {
                if (req.io) {
                    req.io.emit('NEW_MESSAGE', { id: this.lastID, sender_id: creatorId, sender: 'SYSTEM', group_id: groupId, content: sysMsg, priority: 'URGENT', timestamp: new Date().toISOString() });
                    allMemberIds.forEach(uid => req.io.emit('GROUP_MEMBERSHIP_UPDATE', { targetUserId: uid, groupId: groupId, action: 'ADD' }));
                }
            });
            res.json({ success: true, groupId });
        });
    });
});

// 2. RENAME GROUP
router.post('/groups/:id/rename', authenticateToken, (req, res) => {
    const groupId = req.params.id;
    const { newName } = req.body;
    const userId = req.user.id;

    db.get("SELECT * FROM groups WHERE id = ?", [groupId], (err, group) => {
        if (!group) return res.status(404).json({ error: "Group not found" });
        if (group.created_by !== userId && req.user.role !== 'ADMIN') return res.status(403).json({ error: "Permission denied." });

        db.run("UPDATE groups SET name = ? WHERE id = ?", [newName, groupId], () => {
            const alertMsg = `⚠️ GROUP RENAMED\n\nThis group has been renamed from "${group.name}" to "${newName}".`;
            db.run("INSERT INTO messages (sender_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, 'URGENT', ?)", [userId, groupId, alertMsg, new Date().toISOString()], function () {
                if (req.io) req.io.emit('NEW_MESSAGE', { id: this.lastID, sender_id: userId, sender: 'SYSTEM', group_id: groupId, content: alertMsg, priority: 'URGENT', timestamp: new Date().toISOString() });
            });
            res.json({ success: true });
        });
    });
});

// 3. MANAGE MEMBERS
router.post('/groups/:id/members', authenticateToken, (req, res) => {
    const groupId = req.params.id;
    const { targetUserId, action, notificationType } = req.body;
    const userId = req.user.id;

    db.get("SELECT * FROM groups WHERE id = ?", [groupId], (err, group) => {
        if (!group) return res.status(404).json();
        if (group.created_by !== userId && req.user.role !== 'ADMIN') return res.status(403).json({ error: "Permission denied" });

        db.get("SELECT username FROM users WHERE id = ?", [targetUserId], (err, targetUser) => {
            if (!targetUser) return res.status(404).json({ error: "Target user not found" });

            if (action === 'ADD') {
                db.run("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)", [groupId, targetUserId], function () {
                    if (this.changes > 0) {
                        handleMemberNotification(req.io, userId, groupId, targetUserId, 'ADDED', notificationType, group.name, targetUser.username);
                        req.io.emit('GROUP_MEMBERSHIP_UPDATE', { targetUserId, groupId, action: 'ADD' });
                    }
                    res.json({ success: true });
                });
            } else if (action === 'REMOVE') {
                db.run("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, targetUserId], function () {
                    if (this.changes > 0) {
                        handleMemberNotification(req.io, userId, groupId, targetUserId, 'REMOVED', notificationType, group.name, targetUser.username);
                        reevaluateUrgentMessages(req.io);
                        req.io.emit('GROUP_MEMBERSHIP_UPDATE', { targetUserId, groupId, action: 'REMOVE' });
                    }
                    res.json({ success: true });
                });
            }
        });
    });
});

// 4. DELETE GROUP
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

// 5. TRANSFER OWNERSHIP
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

// 6. LEAVE GROUP
router.post('/groups/leave', authenticateToken, (req, res) => {
    const { groupId } = req.body;
    db.run("DELETE FROM group_members WHERE group_id=? AND user_id=?", [groupId, req.user.id], () => {
        reevaluateUrgentMessages(req.io);
        res.json({ success: true });
    });
});

// ============================================================
// 🧹 HELPERS
// ============================================================

// Helper to downgrade urgent messages if everyone acked/left
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

// Helper for Member Notifications (Private/Public)
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