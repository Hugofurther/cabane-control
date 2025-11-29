const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./cabane.db');
const bcrypt = require('bcryptjs');

db.serialize(() => {
    console.log("--- Initializing Cabane Control Database ---");

    // 1. USERS Table
    // Status: 'PENDING', 'ACTIVE', 'REJECTED'
    // Role: 'ADMIN', 'USER'
    db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT DEFAULT 'USER',
    status TEXT DEFAULT 'PENDING',
    two_factor_secret TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
    console.log("✔ Users Table Ready");

    // 2. SYSTEM LOGS Table
    // Type: 'AUTH', 'CONTROL', 'SYSTEM', 'ALARM'
    db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER,
    type TEXT,
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

    // 4. Create Default Admin Account
    // User: admin
    // Pass: cabane
    const adminName = 'admin';
    const adminPass = 'cabane';
    const adminEmail = 'admin@local.host'; // Change this later in the app

    // Check if admin exists first
    db.get("SELECT * FROM users WHERE username = ?", [adminName], (err, row) => {
        if (!row) {
            const hash = bcrypt.hashSync(adminPass, 10);
            const stmt = db.prepare("INSERT INTO users (username, password_hash, email, role, status) VALUES (?, ?, ?, ?, ?)");
            stmt.run(adminName, hash, adminEmail, 'ADMIN', 'ACTIVE');
            stmt.finalize();
            console.log(`✔ Default Admin Created (User: ${adminName} / Pass: ${adminPass})`);
        } else {
            console.log("✔ Admin account already exists. Skipping creation.");
        }
    });

});

// Close connection safely after a short delay to ensure inserts finish
setTimeout(() => {
    db.close();
    console.log("--- Database Setup Complete ---");
}, 1000);