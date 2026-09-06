Let's begin Phase 1: Server Setup.

We will configure the Raspberry Pi Zero 2 W, install the necessary software (Node.js, SQLite), and create the database structure required for the authentication and logging systems.

Prerequisites

Raspberry Pi Zero 2 W + Ethernet Adapter.

MicroSD Card (16GB+).

Computer to flash the SD card.

Step 1: Flash the OS & Configure SSH

Download Raspberry Pi Imager on your computer.

Choose OS: Select Raspberry Pi OS (other) -> Raspberry Pi OS Lite (64-bit). (Do not choose Desktop; we want the lightweight server version).

Choose Storage: Select your SD card.

⚙️ Settings (Critical): Click the Gear icon:

Hostname: cabane-server

Enable SSH: Use password authentication.

Set Username/Password: (e.g., admin / maple123).

Configure Wireless LAN: Even though you use Ethernet, set up Wi-Fi as a backup.

Write and wait for verification.

Insert SD card into the Pi, connect Ethernet, and power up.

Step 2: Connect & Static IP

Open your computer's terminal (or Putty) and connect:
ssh admin@cabane-server.local (or find the IP in your router).

Set Static IP (Recommended):
The easiest way is to log into your Starlink Router app and "Reserve IP" for the Raspberry Pi. Set it to 192.168.1.200.

If you prefer doing it on the Pi (assuming latest Raspberry Pi OS "Bookworm"):

code
Bash
download
content_copy
expand_less
# Check your connection name (usually 'Wired connection 1' or 'eth0')
nmcli connection show

# Set static IP (Replace 'Wired connection 1' with your actual name if different)
sudo nmcli con mod "Wired connection 1" ipv4.addresses 192.168.1.200/24
sudo nmcli con mod "Wired connection 1" ipv4.gateway 192.168.1.1
sudo nmcli con mod "Wired connection 1" ipv4.dns "1.1.1.1,8.8.8.8"
sudo nmcli con mod "Wired connection 1" ipv4.method manual
sudo nmcli con up "Wired connection 1"
Step 3: Install Environment (Node.js & Tools)

Run these commands one by one to update the system and install the engine.

code
Bash
download
content_copy
expand_less
# 1. Update System
sudo apt update && sudo apt upgrade -y

# 2. Install Utilities (Git, SQLite3)
sudo apt install -y git sqlite3

# 3. Install Node.js (Version 20 LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 4. Install Process Manager (Keeps the server alive)
sudo npm install -g pm2

# 5. Check versions (Verify installation)
node -v
npm -v
sqlite3 -version
Step 4: Project Initialization & Database

Now we create the project folder and the database structure defined in the PRD.

Create Directory:

code
Bash
download
content_copy
expand_less
mkdir ~/cabane-control
cd ~/cabane-control

Initialize Node Project:

code
Bash
download
content_copy
expand_less
npm init -y

Install Backend Libraries:

code
Bash
download
content_copy
expand_less
npm install express socket.io sqlite3 bcrypt jsonwebtoken nodemailer cors dotenv

Create the Database Schema:
We will create a script to build the database tables (users, logs, messages).

Run this command to create the file: nano setup_db.js

Paste the following code into the editor:

code
JavaScript
download
content_copy
expand_less
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./cabane.db');

db.serialize(() => {
  console.log("Creating Tables...");

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

  // 2. SYSTEM LOGS Table (Only changes are logged)
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

  // 3. MESSAGES Table
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    sender_id INTEGER,
    recipient_id INTEGER, -- NULL means Global Chat
    content TEXT,
    is_read BOOLEAN DEFAULT 0,
    FOREIGN KEY(sender_id) REFERENCES users(id)
  )`);

  // 4. Create Initial Admin Account (Safety fallback)
  // Username: admin, Password: 'password' (Change immediately!)
  // Hash generated for 'password'
  const adminHash = '$2b$10$X8/././././././././././.eExampleHashPlaceholder'; 
  
  // You will generate a real hash in the next steps, but this structure is ready.
  console.log("Database initialized successfully: cabane.db");
});

db.close();

Run the script:
Save the file (Ctrl+O, Enter) and Exit (Ctrl+X).
Run it:

code
Bash
download
content_copy
expand_less
node setup_db.js
Step 5: Verify

If everything went well, you should see Database initialized successfully.
You can verify the file exists by typing ls -l. You should see cabane.db.

Task List Check:

OS Installed.

Network Configured.

Node.js Installed.

Database Created.

Next Step:
We need to write the Backend Logic (Phase 2). This involves creating the UDP Service to talk to your Arduino Main Controller and the "Virtual Logic Engine" for redundancy.

Are you ready to build the UDP Bridge code?