const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const db = require('../db'); // ✅ Import Shared DB

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
        if (!err && note && io) io.emit('NOTE_UPDATE', note);
    });
};

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
        WHERE n.creator_id = ? OR n.id IN (SELECT note_id FROM note_shares WHERE user_id = ?)
        GROUP BY n.id ORDER BY n.updated_at DESC
    `;
    db.all(sql, [userId, userId, userId], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(rows);
    });
});

router.post('/notes', authenticateToken, (req, res) => {
    const { title, content } = req.body;
    const timestamp = new Date().toISOString();
    const history = JSON.stringify([{ action: 'CREATED', user: req.user.username, timestamp }]);
    db.run("INSERT INTO notes (creator_id, title, content, share_history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [req.user.id, title, content, history, timestamp, timestamp],
        function (err) {
            if (err) return res.status(500).json({ error: "Failed" });
            fetchNoteAndEmit(this.lastID, req.io);
            res.json({ success: true, id: this.lastID });
        }
    );
});

router.put('/notes/:id', authenticateToken, (req, res) => {
    const { title, content } = req.body;
    const timestamp = new Date().toISOString();
    db.run("UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ? AND creator_id = ?",
        [title, content, timestamp, req.params.id, req.user.id],
        function (err) {
            if (this.changes === 0) return res.status(403).json({ error: "Denied" });
            fetchNoteAndEmit(req.params.id, req.io);
            res.json({ success: true });
        }
    );
});

router.delete('/notes/:id', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const userId = req.user.id;
    db.get("SELECT creator_id FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json();
        if (note.creator_id === userId) {
            db.run("DELETE FROM notes WHERE id = ?", [noteId], () => {
                req.io.emit('NOTE_DELETE', { id: noteId });
                res.json({ success: true });
            });
        } else {
            db.run("DELETE FROM note_shares WHERE note_id = ? AND user_id = ?", [noteId, userId], () => {
                fetchNoteAndEmit(noteId, req.io);
                res.json({ success: true });
            });
        }
    });
});

router.post('/notes/:id/share', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const { targetUserId } = req.body;
    db.get("SELECT * FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json();
        db.get("SELECT 1 FROM note_shares WHERE note_id = ? AND user_id = ?", [noteId, req.user.id], (err, share) => {
            if (note.creator_id !== req.user.id && !share) return res.status(403).json({ error: "Denied" });
            db.run("INSERT OR IGNORE INTO note_shares (note_id, user_id) VALUES (?, ?)", [noteId, targetUserId], function () {
                let history = []; try { history = JSON.parse(note.share_history || '[]'); } catch (e) { }
                history.push({ action: (note.creator_id === req.user.id ? 'SHARED' : 'RE-SHARED'), user: req.user.username, timestamp: new Date().toISOString() });
                db.run("UPDATE notes SET share_history = ? WHERE id = ?", [JSON.stringify(history), noteId]);
                fetchNoteAndEmit(noteId, req.io);

                // Notify User
                const sysMsg = `📄 SHARED NOTE: "${note.title}"\nHas been shared with you by ${req.user.username}.`;
                db.run("INSERT INTO messages (sender_id, recipient_id, content, priority, timestamp) VALUES (?, ?, ?, 'NORMAL', ?)", [req.user.id, targetUserId, sysMsg, new Date().toISOString()], function () {
                    req.io.emit('NEW_MESSAGE', { id: this.lastID, sender_id: req.user.id, sender: 'SYSTEM', recipient_id: targetUserId, content: sysMsg, priority: 'NORMAL', timestamp: new Date().toISOString(), is_read_by_me: 0, is_ack_by_me: 0 });
                });
                res.json({ success: true });
            });
        });
    });
});

router.post('/notes/:id/unshare', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const { targetUserId } = req.body;
    db.get("SELECT creator_id, share_history FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (note.creator_id !== req.user.id) return res.status(403).json({ error: "Denied" });
        db.run("DELETE FROM note_shares WHERE note_id = ? AND user_id = ?", [noteId, targetUserId], function () {
            if (this.changes > 0) {
                let history = []; try { history = JSON.parse(note.share_history || '[]'); } catch (e) { }
                db.get("SELECT username FROM users WHERE id = ?", [targetUserId], (err, u) => {
                    history.push({ action: 'REVOKED', user: req.user.username, target: u ? u.username : "User", timestamp: new Date().toISOString() });
                    db.run("UPDATE notes SET share_history = ? WHERE id = ?", [JSON.stringify(history), noteId]);
                    fetchNoteAndEmit(noteId, req.io);
                    req.io.emit('NOTE_DELETE', { id: noteId, targetUserId });
                });
            }
            res.json({ success: true });
        });
    });
});

// FLASH NOTE
router.post('/notes/:id/flash', authenticateToken, (req, res) => {
    const noteId = req.params.id;
    const { targetUserId } = req.body;
    db.get("SELECT * FROM notes WHERE id = ?", [noteId], (err, note) => {
        if (!note) return res.status(404).json();
        db.serialize(() => {
            db.run("INSERT OR IGNORE INTO note_shares (note_id, user_id) VALUES (?, ?)", [noteId, targetUserId]);

            let history = []; try { history = JSON.parse(note.share_history || '[]'); } catch (e) { }
            history.push({ action: (note.creator_id === req.user.id ? 'FLASHED' : 'RE-FLASHED'), user: req.user.username, timestamp: new Date().toISOString() });
            db.run("UPDATE notes SET share_history = ? WHERE id = ?", [JSON.stringify(history), noteId]);
            fetchNoteAndEmit(noteId, req.io);

            const fullNoteSql = `SELECT n.id, n.title, n.content, n.creator_id, u.username as creator_name, GROUP_CONCAT(s.username, ', ') as shared_with_names FROM notes n JOIN users u ON n.creator_id = u.id LEFT JOIN note_shares ns ON n.id = ns.note_id LEFT JOIN users s ON ns.user_id = s.id WHERE n.id = ? GROUP BY n.id`;
            db.get(fullNoteSql, [noteId], (err, fullNote) => {
                const timestamp = new Date().toISOString();
                // Ensure sharedWith has value
                let finalSharedWith = fullNote.shared_with_names || "";
                db.get("SELECT username FROM users WHERE id = ?", [targetUserId], (err, targetUser) => {
                    if (targetUser && !finalSharedWith.includes(targetUser.username)) {
                        finalSharedWith = finalSharedWith ? `${finalSharedWith}, ${targetUser.username}` : targetUser.username;
                    }
                    const payload = JSON.stringify({ type: 'NOTE_FLASH', noteId: fullNote.id, title: fullNote.title, content: fullNote.content, sharedBy: req.user.username, shareHistory: history, sharedWith: finalSharedWith, originalCreatorId: fullNote.creator_id, creatorName: fullNote.creator_name });
                    db.run("INSERT INTO messages (sender_id, recipient_id, content, priority, timestamp) VALUES (?, ?, ?, 'URGENT', ?)", [req.user.id, targetUserId, payload, timestamp], function () {
                        if (req.io) req.io.emit('NEW_MESSAGE', { id: this.lastID, sender_id: req.user.id, sender: req.user.username, recipient_id: targetUserId, group_id: null, content: payload, priority: 'URGENT', timestamp, is_read_by_me: 0, is_ack_by_me: 0 });
                        res.json({ success: true });
                    });
                });
            });
        });
    });
});

module.exports = router;