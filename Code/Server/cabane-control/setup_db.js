const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./cabane.db');
const bcrypt = require('bcryptjs');

// Load env to get Admin Email
require('dotenv').config();

db.serialize(() => {
  console.log("--- Initializing Cabane Control Database (v2 Complete) ---");

  // 1. USERS Table (Consolidated Schema)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT DEFAULT 'USER',         -- 'ADMIN' or 'USER'
    status TEXT DEFAULT 'UNVERIFIED', -- 'UNVERIFIED', 'PENDING', 'ACTIVE', 'REJECTED'
    verification_token TEXT,
    reset_token TEXT,
    settings TEXT DEFAULT '{}',       -- JSON string for UI prefs
    can_control BOOLEAN DEFAULT 0,    -- Permission to drive system
    can_view_logs BOOLEAN DEFAULT 0,  -- Permission to read logs
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  console.log("✔ Users Table Ready");

  // 2. LOGS Table
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

  // 3. MESSAGES Table
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    sender_id INTEGER,
    recipient_id INTEGER, 
    content TEXT,
    is_read BOOLEAN DEFAULT 0,
    FOREIGN KEY(sender_id) REFERENCES users(id)
  )`);
  console.log("✔ Messages Table Ready");

  // 4. SYSTEM SETTINGS Table (New)
  // Key: 'timezone', Value: 'America/New_York'
  db.run(`CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Insert Default Timezone if missing
  db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('timezone', 'UTC')");

  console.log("✔ Settings Table Ready");


  // 5. Create Default Admin Account
  const adminName = 'admin';
  const adminPass = 'cabane'; // Change immediately after login
  const adminEmail = process.env.ADMIN_EMAIL || 'hugofurther@gmail.com';

  db.get("SELECT * FROM users WHERE username = ?", [adminName], (err, row) => {
    if (!row) {
      const hash = bcrypt.hashSync(adminPass, 10);

      const stmt = db.prepare(`
          INSERT INTO users 
          (username, password_hash, email, role, status, can_control, can_view_logs, settings) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

      // Admin gets ALL permissions by default
      const defaultSettings = JSON.stringify({ soundEnabled: true, vibrationEnabled: true });

      stmt.run(adminName, hash, adminEmail, 'ADMIN', 'ACTIVE', 1, 1, defaultSettings);
      stmt.finalize();

      console.log(`✔ Default Admin Created (User: ${adminName} / Pass: ${adminPass})`);
    } else {
      console.log("✔ Admin account already exists. Skipping creation.");
    }
  });
});

// Close connection
setTimeout(() => {
  db.close();
  console.log("--- Database Setup Complete ---");
}, 1000);