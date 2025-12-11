const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const db = require('../db'); // ✅ Import Shared DB

router.get('/messages', authenticateToken, (req, res) => {
    const { type, targetId } = req.query;
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    let sql = `SELECT m.*, u.username as sender, g.name as group_name, r.username as recipient_name, CASE WHEN mr.read_at IS NOT NULL THEN 1 ELSE 0 END as is_read_by_me, CASE WHEN mua.ack_at IS NOT NULL THEN 1 ELSE 0 END as is_ack_by_me FROM messages m JOIN users u ON m.sender_id = u.id LEFT JOIN groups g ON m.group_id = g.id LEFT JOIN users r ON m.recipient_id = r.id LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = ? LEFT JOIN message_urgency_acks mua ON m.id = mua.message_id AND mua.user_id = ? WHERE `;
    let params = [userId, userId];

    if (type === 'GLOBAL') { sql += `m.recipient_id IS NULL AND m.group_id IS NULL`; }
    else if (type === 'NOTES') { sql += `m.recipient_id = ? AND m.sender_id = ?`; params.push(userId, userId); }
    else if (type === 'DM') { sql += `((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)) AND m.group_id IS NULL`; params.push(userId, targetId, targetId, userId); }
    else if (type === 'GROUP') { sql += `m.group_id = ?`; params.push(targetId); }
    else { sql += `(m.recipient_id IS NULL AND m.group_id IS NULL) OR (m.recipient_id = ? OR m.sender_id = ?) OR (m.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?))`; params.push(userId, userId, userId); }

    sql += ` ORDER BY m.timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => { if (err) return res.status(500).json(); res.json(rows.reverse()); });
});

router.post('/messages', authenticateToken, (req, res) => {
    const { content, recipientId, groupId, priority, tempId } = req.body;
    const timestamp = new Date().toISOString();
    db.run("INSERT INTO messages (sender_id, recipient_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, ?, ?, ?)", [req.user.id, recipientId, groupId, content, priority || 'NORMAL', timestamp], function (err) {
        if (err) return res.status(500).json();
        if (req.io) req.io.emit('NEW_MESSAGE', { id: this.lastID, tempId, timestamp, sender_id: req.user.id, sender: req.user.username, recipient_id: recipientId, group_id: groupId, content, priority, is_read_by_me: 0, is_ack_by_me: 0 });
        res.json({ success: true, id: this.lastID });
    });
});

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

// Group Routes
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
// ... [Include rename/delete group routes similar to above pattern if needed, otherwise this is the core messaging] ...

module.exports = router;