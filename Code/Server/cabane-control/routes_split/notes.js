const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const db = require('../db'); // ✅ Import Shared DB

// ============================================================
// 🛠️ HELPER FUNCTIONS
// ============================================================

// Fetch single note with full metadata and emit via Socket
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
            io.emit('NOTE_UPDATE', note);
        }
    });
};

// ============================================================
// 📝 CORE CRUD ROUTES
// ============================================================

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

// UPDATE NOTE (Owner Only)
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

// DELETE NOTE (Owner Deletes / Viewer Unsubscribes)
router.delete('/notes/:id', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const userId = req.user.id;

    db.get("SELECT creator_id FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json({ error: "Note not found" });

        if (note.creator_id === userId) {
            // Owner -> Hard Delete (Cascade deletes shares)
            db.run("DELETE FROM notes WHERE id = ?", [noteId], () => {
                req.io.emit('NOTE_DELETE', { id: noteId });
                res.json({ success: true });
            });
        } else {
            // Viewer -> Remove Share
            db.run("DELETE FROM note_shares WHERE note_id = ? AND user_id = ?", [noteId, userId], () => {
                // Viewer removed themselves, update the "Shared With" list for others
                fetchNoteAndEmit(noteId, req.io);
                res.json({ success: true });
            });
        }
    });
});

// COPY NOTE (Fork)
router.post('/notes/:id/copy', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const userId = req.user.id;
    const timestamp = new Date().toISOString();

    db.get("SELECT title, content, creator_id FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json();

        // Get creator name
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

// ============================================================
// 🤝 SHARE NOTE (Standard - Global/Group/User)
// ============================================================
router.post('/notes/:id/share', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const { targetId, targetType, targetUserId } = req.body;
    const userId = req.user.id;
    // Normalize target ID (Frontends might send targetUserId OR targetId)
    const realTargetId = targetUserId || targetId;

    db.get("SELECT * FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json();

        // Check Permissions (Owner OR Existing Share)
        const checkAccessSql = `SELECT 1 FROM note_shares WHERE note_id = ? AND user_id = ?`;
        db.get(checkAccessSql, [noteId, userId], (err, share) => {
            if (note.creator_id !== userId && !share) return res.status(403).json({ error: "Permission denied" });

            db.serialize(() => {
                let sharedWithLabel = "";

                // 1. Grant Access
                if (targetType === 'GLOBAL') {
                    db.run("INSERT OR IGNORE INTO note_shares (note_id, user_id) SELECT ?, id FROM users", [noteId]);
                    sharedWithLabel = "Everyone (Global)";
                }
                else if (targetType === 'GROUP') {
                    db.run("INSERT OR IGNORE INTO note_shares (note_id, user_id) SELECT ?, user_id FROM group_members WHERE group_id = ?", [noteId, realTargetId]);
                    db.get("SELECT name FROM groups WHERE id = ?", [realTargetId], (err, g) => {
                        sharedWithLabel = g ? `Group: ${g.name}` : "Group";
                    });
                }
                else {
                    db.run("INSERT OR IGNORE INTO note_shares (note_id, user_id) VALUES (?, ?)", [noteId, realTargetId]);
                }

                // 2. Update History & Notify (Delayed slightly to allow Group Name fetch)
                setTimeout(() => {
                    let history = [];
                    try { history = JSON.parse(note.share_history || '[]'); } catch (e) { }
                    const action = (note.creator_id === userId) ? 'SHARED' : 'RE-SHARED';

                    history.push({
                        action,
                        user: req.user.username,
                        target: sharedWithLabel || "User",
                        timestamp: new Date().toISOString()
                    });

                    db.run("UPDATE notes SET share_history = ? WHERE id = ?", [JSON.stringify(history), noteId]);

                    // 3. Emit Updates
                    fetchNoteAndEmit(noteId, req.io);

                    // 4. Send Standard Chat Message
                    const sysMsg = `📄 SHARED NOTE: "${note.title}"\nShared by ${req.user.username}. Check your Notes tab.`;
                    const timestamp = new Date().toISOString();

                    const emitMsg = (rId, gId) => {
                        req.io.emit('NEW_MESSAGE', {
                            id: this.lastID,
                            sender_id: userId,
                            sender: 'SYSTEM',
                            recipient_id: rId,
                            group_id: gId,
                            content: sysMsg,
                            priority: 'NORMAL',
                            timestamp,
                            is_read_by_me: 0,
                            is_ack_by_me: 0
                        });
                    };

                    if (targetType === 'GLOBAL') {
                        db.run("INSERT INTO messages (sender_id, content, priority, timestamp) VALUES (?, ?, 'NORMAL', ?)",
                            [userId, sysMsg, timestamp], () => emitMsg(null, null));
                    } else if (targetType === 'GROUP') {
                        db.run("INSERT INTO messages (sender_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, 'NORMAL', ?)",
                            [userId, realTargetId, sysMsg, timestamp], () => emitMsg(null, realTargetId));
                    } else {
                        db.run("INSERT INTO messages (sender_id, recipient_id, content, priority, timestamp) VALUES (?, ?, ?, 'NORMAL', ?)",
                            [userId, realTargetId, sysMsg, timestamp], () => emitMsg(realTargetId, null));
                    }

                    res.json({ success: true });
                }, 50);
            });
        });
    });
});

// ============================================================
// 🚫 UNSHARE NOTE (Owner Revokes Access)
// ============================================================
router.post('/notes/:id/unshare', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const { targetUserId } = req.body;
    const userId = req.user.id;

    db.get("SELECT creator_id, title, share_history FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json({ error: "Note not found" });

        // Only Owner can revoke specific shares
        if (note.creator_id !== userId) return res.status(403).json({ error: "Permission denied" });

        db.run("DELETE FROM note_shares WHERE note_id = ? AND user_id = ?", [noteId, targetUserId], function () {
            if (this.changes > 0) {
                // Update History
                let history = [];
                try { history = JSON.parse(note.share_history || '[]'); } catch (e) { }

                // Get target username for history log
                db.get("SELECT username FROM users WHERE id = ?", [targetUserId], (err, u) => {
                    const targetName = u ? u.username : "User";
                    history.push({
                        action: 'REVOKED',
                        user: req.user.username,
                        target: targetName,
                        timestamp: new Date().toISOString()
                    });

                    db.run("UPDATE notes SET share_history = ? WHERE id = ?", [JSON.stringify(history), noteId]);

                    // Emit Update
                    fetchNoteAndEmit(noteId, req.io);

                    // Notify target they lost access (Remove from their list)
                    req.io.emit('NOTE_DELETE', { id: noteId, targetUserId });
                });
            }
            res.json({ success: true });
        });
    });
});

// ============================================================
// ⚡ FLASH NOTE (Memo Reminder - Global/Group/User)
// ============================================================
router.post('/notes/:id/flash', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const { targetId, targetType, targetUserId } = req.body;
    const userId = req.user.id;
    const realTargetId = targetUserId || targetId;

    db.get("SELECT * FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json();

        db.serialize(() => {
            let sharedWithLabel = "";

            // 1. Grant Access
            if (targetType === 'GLOBAL') {
                db.run("INSERT OR IGNORE INTO note_shares (note_id, user_id) SELECT ?, id FROM users", [noteId]);
                sharedWithLabel = "Global (All Users)";
            }
            else if (targetType === 'GROUP') {
                db.run("INSERT OR IGNORE INTO note_shares (note_id, user_id) SELECT ?, user_id FROM group_members WHERE group_id = ?", [noteId, realTargetId]);
                db.get("SELECT name FROM groups WHERE id = ?", [realTargetId], (err, g) => {
                    sharedWithLabel = g ? `Group: ${g.name}` : "Group";
                });
            }
            else {
                db.run("INSERT OR IGNORE INTO note_shares (note_id, user_id) VALUES (?, ?)", [noteId, realTargetId]);
            }

            // 2. Update History
            let history = [];
            try { history = JSON.parse(note.share_history || '[]'); } catch (e) { }
            const action = (note.creator_id === userId) ? 'FLASHED' : 'RE-FLASHED';

            setTimeout(() => {
                history.push({
                    action,
                    user: req.user.username,
                    target: sharedWithLabel || "User",
                    timestamp: new Date().toISOString()
                });

                db.run("UPDATE notes SET share_history = ? WHERE id = ?", [JSON.stringify(history), noteId], () => {

                    // 3. Emit Updates for Note Lists
                    fetchNoteAndEmit(noteId, req.io);

                    // 4. Generate Payload (Fetching exact 'Shared With' list from DB for Payload)
                    const fullNoteSql = `
                        SELECT 
                            n.id, n.title, n.content, n.creator_id,
                            u.username as creator_name,
                            GROUP_CONCAT(s.username, ', ') as shared_with_names
                        FROM notes n
                        JOIN users u ON n.creator_id = u.id
                        LEFT JOIN note_shares ns ON n.id = ns.note_id
                        LEFT JOIN users s ON ns.user_id = s.id
                        WHERE n.id = ?
                        GROUP BY n.id
                    `;

                    db.get(fullNoteSql, [noteId], (err, fullNote) => {
                        let finalSharedWith = fullNote.shared_with_names || "";

                        // Fallback check: If target user wasn't picked up by GROUP_CONCAT yet
                        db.get("SELECT username FROM users WHERE id = ?", [realTargetId], (err, targetUser) => {
                            if (targetType === 'USER' && targetUser && !finalSharedWith.includes(targetUser.username)) {
                                finalSharedWith = finalSharedWith ? `${finalSharedWith}, ${targetUser.username}` : targetUser.username;
                            }

                            const timestamp = new Date().toISOString();
                            const payload = JSON.stringify({
                                type: 'NOTE_FLASH',
                                noteId: fullNote.id,
                                title: fullNote.title,
                                content: fullNote.content,
                                sharedBy: req.user.username,
                                shareHistory: history,
                                sharedWith: finalSharedWith,
                                originalCreatorId: fullNote.creator_id,
                                creatorName: fullNote.creator_name
                            });

                            // 5. Send Message to correct channel
                            const emitMsg = (rId, gId) => {
                                if (req.io) req.io.emit('NEW_MESSAGE', {
                                    id: this.lastID,
                                    sender_id: userId,
                                    sender: req.user.username,
                                    recipient_id: rId,
                                    group_id: gId,
                                    content: payload,
                                    priority: 'URGENT',
                                    timestamp,
                                    is_read_by_me: 0,
                                    is_ack_by_me: 0
                                });
                                res.json({ success: true });
                            };

                            if (targetType === 'GLOBAL') {
                                db.run("INSERT INTO messages (sender_id, content, priority, timestamp) VALUES (?, ?, 'URGENT', ?)",
                                    [userId, payload, timestamp], () => emitMsg(null, null));
                            } else if (targetType === 'GROUP') {
                                db.run("INSERT INTO messages (sender_id, group_id, content, priority, timestamp) VALUES (?, ?, ?, 'URGENT', ?)",
                                    [userId, realTargetId, payload, timestamp], () => emitMsg(null, realTargetId));
                            } else {
                                db.run("INSERT INTO messages (sender_id, recipient_id, content, priority, timestamp) VALUES (?, ?, ?, 'URGENT', ?)",
                                    [userId, realTargetId, payload, timestamp], () => emitMsg(realTargetId, null));
                            }
                        });
                    });
                });
            }, 50); // Small delay to allow Group Name fetch to complete
        });
    });
});

module.exports = router;