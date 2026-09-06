# Auto-Start Setup Guide (PM2)
## Cabane Control Server

This guide details how to configure the Raspberry Pi to automatically launch the Node.js backend (`server.js`) whenever the device boots up or recovers from a power failure, using **PM2** (Process Manager 2).

### 1. Prerequisites
*   SSH access to the Raspberry Pi (`ssh admin@192.168.1.200`).
*   Node.js and NPM installed.
*   The application code located in `~/cabane-control`.

---

### 2. Configuration Steps

#### Step 1: Install PM2 (If not already installed)
```bash
sudo npm install -g pm2
Step 2: Start the Application

Navigate to the project folder and start the server. We give it the name "cabane-server" to make it easy to identify later.

code
Bash
download
content_copy
expand_less
cd ~/cabane-control
pm2 start server.js --name "cabane-server"

If the server was already running manually via node server.js, stop it first with Ctrl+C.

Step 3: Generate Startup Script

This command tells PM2 to detect the OS init system (Systemd) and generate a startup command.

code
Bash
download
content_copy
expand_less
pm2 startup

⚠️ CRITICAL STEP:
The terminal will output a command starting with sudo env PATH=....
You must copy and paste that specific line back into your terminal and press Enter.

Step 4: Save Process List

This freezes the current list of running processes (just "cabane-server") into the startup configuration.

code
Bash
download
content_copy
expand_less
pm2 save
3. Verification

To ensure the system works as expected:

Reboot the Pi:

code
Bash
download
content_copy
expand_less
sudo reboot

Wait: Allow ~60 seconds for the Pi to boot and initialize the network.

Check: Open your browser to your Cloudflare URL or Tailscale IP. The login screen should appear.

Verify via SSH:

code
Bash
download
content_copy
expand_less
pm2 status

Status should show "online" with an uptime matching the reboot time.

4. Maintenance Cheat Sheet

Since the server runs in the background, use these commands to manage it.

Action	Command:

- View Live Logs
pm2 logs cabane-server

- Monitor CPU/RAM
pm2 monit

- Restart Server
pm2 restart cabane-server

- Stop Server
pm2 stop cabane-server

- List Processes	pm2
list

- Update Startup Run
pm2 save
after adding/removing processes
Troubleshooting: Server crashing immediately?

If pm2 status shows the server restarting constantly (errored or high restart count):

Check logs: pm2 logs cabane-server --lines 50

Common causes: Missing .env file variables, Port 3000 already in use, or syntax errors in code.

code
Code
download
content_copy
expand_less