const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./cabane.db');
const bcrypt = require('bcryptjs');

// Load environment variables (for Admin Email)
require('dotenv').config();

db.serialize(() => {
  console.log("--- Initializing Cabane Control Database (Full Production Schema) ---");

  // ============================================================
  // 1. USERS & PERMISSIONS
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT DEFAULT 'USER',         -- 'ADMIN' or 'USER'
    status TEXT DEFAULT 'UNVERIFIED', -- 'UNVERIFIED', 'PENDING', 'ACTIVE', 'REJECTED'
    verification_token TEXT,
    reset_token TEXT,
    settings TEXT DEFAULT '{}',       -- JSON: { soundEnabled, vibrationEnabled, tempUnit, clockFormat... }
    can_control BOOLEAN DEFAULT 0,    -- Permission to drive system
    can_view_logs BOOLEAN DEFAULT 0,  -- Permission to read logs
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  console.log("✔ Users Table Ready");

  // ============================================================
  // 2. SYSTEM LOGS & SETTINGS
  // ============================================================
  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER,
    type TEXT,    -- 'AUTH', 'CONTROL', 'SYSTEM', 'ALARM', 'SWITCH', 'AUTO'
    message TEXT,
    metadata TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  console.log("✔ Logs Table Ready");

  db.run(`CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  // Insert default Timezone if missing
  db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('timezone', 'UTC')");
  console.log("✔ System Settings Table Ready");

  // ============================================================
  // 3. MESSAGING SYSTEM
  // ============================================================

  // Messages Container
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    sender_id INTEGER,
    recipient_id INTEGER, -- NULL for Global/Group
    group_id INTEGER,     -- NULL for Global/DM
    content TEXT,
    priority TEXT DEFAULT 'NORMAL', -- 'NORMAL' or 'URGENT'
    FOREIGN KEY(sender_id) REFERENCES users(id)
  )`);

  // Groups
  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Group Memberships
  db.run(`CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER,
    user_id INTEGER,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);


  // Per-User Read Receipts
  db.run(`CREATE TABLE IF NOT EXISTS message_reads (
    message_id INTEGER, 
    user_id INTEGER, 
    read_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
    PRIMARY KEY (message_id, user_id)
  )`);

  // Per-User Urgency Acknowledgment
  db.run(`CREATE TABLE IF NOT EXISTS message_urgency_acks (
    message_id INTEGER, 
    user_id INTEGER, 
    ack_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  console.log("✔ Messaging Tables Ready");

  // Optimization Indices
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id)");
  console.log("✔ Messaging Indices Ready");

  // ============================================================
  // 4. DEFAULT ADMIN CREATION
  // ============================================================
  const adminName = 'admin';
  const adminPass = 'cabane'; // ⚠️ Change immediately after login
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@local.host';

  db.get("SELECT * FROM users WHERE username = ?", [adminName], (err, row) => {
    if (!row) {
      const hash = bcrypt.hashSync(adminPass, 10);

      const stmt = db.prepare(`
          INSERT INTO users 
          (username, password_hash, email, role, status, can_control, can_view_logs, settings) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

      // Admin gets ALL permissions and default settings
      const defaultSettings = JSON.stringify({
        soundEnabled: true,
        vibrationEnabled: true,
        clockFormat: '24h',
        tempUnit: 'C'
      });

      stmt.run(adminName, hash, adminEmail, 'ADMIN', 'ACTIVE', 1, 1, defaultSettings);
      stmt.finalize();

      console.log(`✔ Default Admin Created (User: ${adminName} / Pass: ${adminPass})`);
    } else {
      console.log("✔ Admin account already exists. Skipping creation.");
    }
  });
});

// Close connection safely
setTimeout(() => {
  db.close();
  console.log("--- Database Setup Complete ---");
}, 1000);