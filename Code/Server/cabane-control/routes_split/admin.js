const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const db = require('../db');
const checkDiskSpace = require('check-disk-space').default;
const logicEngine = require('../services/logic_engine');

// Helper to Log
const logAction = (io, userId, username, type, message) => {
    const timestamp = new Date().toISOString();
    db.run("INSERT INTO logs (user_id, type, message, timestamp) VALUES (?, ?, ?, ?)", [userId, type, message, timestamp]);
    if (io) io.emit('NEW_LOG', { id: Date.now(), timestamp, user_id: userId, username, type, message });
};

// ============================================================
// ⚙️ SYSTEM SETTINGS (Timezone, Weather, etc.)
// ============================================================

// GET SETTINGS
router.get('/system/settings', authenticateToken, (req, res) => {
    db.all("SELECT key, value FROM system_settings", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        res.json(settings);
    });
});

// SAVE SETTINGS
router.post('/system/settings', authenticateToken, requireAdmin, (req, res) => {
    const settings = req.body;
    const keys = Object.keys(settings);
    if (keys.length === 0) return res.status(400).json({ error: "No settings" });

    let completed = 0;

    // Use a Transaction for safety
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        keys.forEach(key => {
            // Stringify values to ensure they store correctly (especially JSON arrays like weather_locations)
            const val = typeof settings[key] === 'object' ? JSON.stringify(settings[key]) : String(settings[key]);

            db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", [key, val], (err) => {
                if (err) console.error(`Error saving ${key}:`, err);
            });
        });

        db.run("COMMIT", () => {
            // ✅ Notify Services of Changes
            if (settings.timezone) logicEngine.updateTimezone(settings.timezone);
            if (settings.disabled_stations) logicEngine.updateDisabled(settings.disabled_stations);

            // Reload Weather if needed
            if (settings.weather_locations || settings.weather_update_interval || settings.weather_api_key) {
                try {
                    const weatherService = require('../services/weather_service');
                    if (weatherService.reloadSettings) weatherService.reloadSettings();
                } catch (e) { console.error("Weather reload failed", e); }
            }

            // ✅ NEW: Check for Buzzer Config Updates
            if (settings.buzzer_alarm_on || settings.buzzer_alarm_off || settings.buzzer_reminder_min) {
                // Fetch latest values (mix of new and existing) to be safe
                db.all("SELECT key, value FROM system_settings WHERE key IN ('buzzer_alarm_on', 'buzzer_alarm_off', 'buzzer_reminder_min')", (err, rows) => {
                    let on = 5, off = 10, rem = 2; // Defaults
                    rows.forEach(r => {
                        if (r.key === 'buzzer_alarm_on') on = parseInt(r.value);
                        if (r.key === 'buzzer_alarm_off') off = parseInt(r.value);
                        if (r.key === 'buzzer_reminder_min') rem = parseInt(r.value);
                    });
                    logicEngine.updateConfig(on, off, rem);
                });
            }

            // ✅ CHECK FOR BUZZER or BURGLAR CONFIG
            if (settings.buzzer_alarm_on || settings.buzzer_alarm_off || settings.buzzer_reminder_min || settings.burglar_station) {
                db.all("SELECT key, value FROM system_settings WHERE key IN ('buzzer_alarm_on', 'buzzer_alarm_off', 'buzzer_reminder_min', 'burglar_station')", (err, rows) => {
                    let on = 5, off = 10, rem = 2, burg = 0;
                    rows.forEach(r => {
                        if (r.key === 'buzzer_alarm_on') on = parseInt(r.value);
                        if (r.key === 'buzzer_alarm_off') off = parseInt(r.value);
                        if (r.key === 'buzzer_reminder_min') rem = parseInt(r.value);
                        if (r.key === 'burglar_station') burg = parseInt(r.value);
                    });
                    logicEngine.updateConfig(on, off, rem, burg);
                });
            }

            logAction(req.io, req.user.id, req.user.username, 'SYSTEM', 'Updated System Settings');
            res.json({ success: true });
        });
    });
});

// ============================================================
// 📊 STATUS & LOGS
// ============================================================

router.get('/system/status', authenticateToken, async (req, res) => {
    try {
        const space = await checkDiskSpace('/');
        res.json({ diskUsage: `${Math.round(((space.size - space.free) / space.size) * 100)}%`, free: space.free, size: space.size });
    } catch (e) { res.json({ diskUsage: 'Unknown', free: 0, size: 0 }); }
});

router.get('/logs', authenticateToken, (req, res) => {
    db.get("SELECT role, can_view_logs FROM users WHERE id = ?", [req.user.id], (err, user) => {
        if (!user || (user.role !== 'ADMIN' && !user.can_view_logs)) return res.status(403).json();
        db.all(`SELECT l.*, u.username FROM logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.timestamp DESC LIMIT ?`, [parseInt(req.query.limit) || 100], (err, rows) => res.json(rows));
    });
});

// ============================================================
// 🏭 CONTROL (Admin/User Actions)
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
    logAction(req.io, req.user.id, req.user.username, 'CONTROL', 'Released to Server (Hold)');
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

    // Check active controller
    const state = logicEngine.getFullState();
    if (state.controller === 'SERVER' || state.currentUser === req.user.username) {
        logicEngine.toggleSwitch(index, value, req.user.username);
        logAction(req.io, req.user.id, req.user.username, 'SWITCH', `Toggled Switch ${index} ${value ? 'ON' : 'OFF'}`);
        res.json({ success: true });
    } else {
        return res.status(403).json({ error: "Not active controller" });
    }
});

// ============================================================
// 👥 USER MANAGEMENT
// ============================================================

router.get('/users', authenticateToken, requireAdmin, (req, res) => {
    db.all("SELECT id, username, email, role, status, can_control, can_view_logs, created_at FROM users", [], (err, rows) => res.json(rows));
});

router.post('/users/approve', authenticateToken, requireAdmin, (req, res) => {
    db.run("UPDATE users SET status = 'ACTIVE' WHERE id = ?", [req.body.userId], () => res.json({ success: true }));
});

router.post('/users/permission', authenticateToken, requireAdmin, (req, res) => {
    const { userId, type, value } = req.body;
    const col = type === 'control' ? 'can_control' : 'can_view_logs';
    db.run(`UPDATE users SET ${col} = ? WHERE id = ?`, [value ? 1 : 0, userId], () => {
        req.io.emit('USER_PERMISSION_UPDATE', { userId, key: col, value: value ? 1 : 0 });
        res.json({ success: true });
    });
});

router.post('/users/delete', authenticateToken, requireAdmin, (req, res) => {
    db.run("DELETE FROM users WHERE id = ?", [req.body.userId], () => res.json({ success: true }));
});

router.post('/users/transfer-admin', authenticateToken, requireAdmin, (req, res) => {
    const { newAdminId } = req.body;
    const currentAdminId = req.user.id;

    if (String(currentAdminId) === String(newAdminId)) return res.status(400).json({ error: "Cannot transfer to yourself." });

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        // Promote New
        db.run("UPDATE users SET role = 'ADMIN', can_control = 1, can_view_logs = 1 WHERE id = ?", [newAdminId]);
        // Demote Old
        db.run("UPDATE users SET role = 'USER' WHERE id = ?", [currentAdminId]);

        db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: "DB Error" });

            // Broadcast changes
            req.io.emit('USER_PERMISSION_UPDATE', { userId: currentAdminId, key: 'role', value: 'USER' });
            req.io.emit('USER_PERMISSION_UPDATE', { userId: newAdminId, key: 'role', value: 'ADMIN' });

            res.json({ success: true });
        });
    });
});

module.exports = router;