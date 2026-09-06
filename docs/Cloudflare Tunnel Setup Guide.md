# Cloudflare Tunnel Setup Guide
## Cabane Control System

This guide documents the process of exposing the Raspberry Pi's local Node.js server (Port 3000) to the public internet securely using Cloudflare Tunnel (Zero Trust). This method bypasses CGNAT (Starlink) without requiring port forwarding.

### 1. Prerequisites
*   **Domain Name:** A registered domain (e.g., `yourfarm.com`) managed by Cloudflare.
    *   *If bought elsewhere, update nameservers to Cloudflare's.*
*   **Cloudflare Account:** Free tier is sufficient.
*   **Raspberry Pi:** Connected to the internet.

---

### 2. Create the Tunnel (Cloudflare Dashboard)
1.  Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/).
2.  Navigate to **Zero Trust** (Sidebar) > **Networks** > **Tunnels**.
3.  Click **Create a Tunnel**.
4.  **Connector Type:** Select **Cloudflared**.
5.  **Name:** Enter `cabane-pi` (or similar) and click **Save Tunnel**.

---

### 3. Install Agent on Raspberry Pi
On the "Install connector" screen in Cloudflare, choose **Debian** and **64-bit (arm64)** (Assuming Pi Zero 2 W with 64-bit OS).

SSH into your Raspberry Pi and run the following commands:

#### A. Download & Install
```bash
# Download the ARM64 binary
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb

# Install package
sudo dpkg -i cloudflared-linux-arm64.deb
B. Connect & Authenticate

Get your unique token from the Cloudflare Dashboard ("Install connector" box).

code
Bash
download
content_copy
expand_less
# Replace <TOKEN> with the long string starting with eyJh...
sudo cloudflared service install <TOKEN>
C. Verify Service
code
Bash
download
content_copy
expand_less
# Check status
sudo systemctl status cloudflared

# If not active, start it
sudo systemctl start cloudflared

Result: The Cloudflare Dashboard should show the tunnel status as Healthy or Connected.

4. Configure Routing (Public Hostname)

This maps the public URL to your local Node.js app.

In the Cloudflare Tunnel config, click Next (or "Configure" -> "Public Hostname").

Click Add a public hostname.

Subdomain: Enter desired prefix (e.g., control).

Domain: Select your domain (e.g., yourfarm.com).

Path: Leave empty.

Service Type: HTTP

URL: localhost:3000

Click Save Hostname.

Verification: You can now access https://control.yourfarm.com from any 4G/LTE connection.

5. Update Application Configuration

You must tell the Node.js server its new Public URL so that Email Verification and Password Reset links point to the correct address.

Edit .env file:

code
Bash
download
content_copy
expand_less
nano ~/cabane-control/.env

Update PUBLIC_URL:

code
Ini
download
content_copy
expand_less
# Old
# PUBLIC_URL=http://192.168.1.200:3000

# New (HTTPS is handled by Cloudflare automatically)
PUBLIC_URL=https://control.yourfarm.com

Restart Server:

code
Bash
download
content_copy
expand_less
# If running via PM2
pm2 restart cabane-server

# Or if running manually
node server.js
6. Troubleshooting Commands

Check Tunnel Logs:

code
Bash
download
content_copy
expand_less
journalctl -u cloudflared -f

Restart Tunnel Service:

code
Bash
download
content_copy
expand_less
sudo systemctl restart cloudflared

Update Tunnel Agent:

code
Bash
download
content_copy
expand_less
sudo cloudflared update
code
Code
download
content_copy
expand_less