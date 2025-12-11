const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Resolve path to ensure it finds the DB relative to the server root
const dbPath = path.resolve(__dirname, 'cabane.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("❌ Database Connection Failed:", err.message);
    else console.log("✅ Connected to SQLite Database");
});

module.exports = db;