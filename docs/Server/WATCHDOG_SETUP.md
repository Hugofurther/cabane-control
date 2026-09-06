# Hardware Watchdog Setup Guide
## Cabane Control Server (Raspberry Pi)

This guide details how to configure the Raspberry Pi's built-in **Hardware Watchdog**. This ensures the server automatically physically reboots if the Operating System freezes, the Kernel panics, or the CPU load becomes unmanageable. This is critical for a remote "headless" system that cannot be manually power-cycled easily.

### 1. Concept
The Raspberry Pi SoC has a hardware timer. The OS must "feed" (reset) this timer constantly. If the OS freezes or crashes, it stops feeding the timer. When the timer reaches zero, the hardware forces a reboot.

*   **Node.js Crashes:** Handled by **PM2** (Software Restart).
*   **OS/Kernel Crashes:** Handled by **Watchdog** (Hardware Reboot).

---

### 2. Configuration Steps

#### Step 1: Enable Hardware Support
We must tell the bootloader to enable the watchdog module.

1.  Open the boot config file:
    ```bash
    sudo nano /boot/firmware/config.txt
    ```
    *(Note: On older Raspberry Pi OS versions, this might be `/boot/config.txt`)*

2.  Add this line at the very bottom:
    ```ini
    dtparam=watchdog=on
    ```

3.  Save (`Ctrl+O`, `Enter`) and Exit (`Ctrl+X`).
4.  **Reboot** to activate the module:
    ```bash
    sudo reboot
    ```

#### Step 2: Install Watchdog Daemon
This service runs in the background and feeds the timer as long as the system is healthy.

```bash
sudo apt update
sudo apt install watchdog -y
Step 3: Configure the Daemon

Edit the configuration file to define rules for rebooting.

Open config:

code
Bash
download
content_copy
expand_less
sudo nano /etc/watchdog.conf

Uncomment (remove #) and update the following lines:

Enable the Device:

code
Ini
download
content_copy
expand_less
watchdog-device = /dev/watchdog

Set Timeout (Time to wait before rebooting):

code
Ini
download
content_copy
expand_less
watchdog-timeout = 15

Reboot on High Load (Optional safety):

code
Ini
download
content_copy
expand_less
max-load-1 = 24

Save and Exit.

Step 4: Enable Auto-Start

Tell the service to launch on boot.

code
Bash
download
content_copy
expand_less
sudo systemctl enable watchdog
sudo systemctl start watchdog
Step 5: Handle Kernel Panics

If the OS crashes immediately (Kernel Panic), the Watchdog daemon stops instantly. We need the Kernel itself to handle this specific crash type.

Open sysctl config:

code
Bash
download
content_copy
expand_less
sudo nano /etc/sysctl.conf

Add this line at the bottom:

code
Ini
download
content_copy
expand_less
kernel.panic = 10

(Wait 10 seconds after a panic, then reboot).

Save and Exit.

3. Verification & Testing

⚠️ WARNING: This test will force-crash your Pi. Ensure no critical file operations are running.

To verify the Watchdog works, we trigger a manual Kernel Panic.

SSH into the Pi.

Run this command:

code
Bash
download
content_copy
expand_less
echo c | sudo tee /proc/sysrq-trigger

Result:

The SSH session will freeze immediately.

The Pi will become unresponsive.

Wait ~15-20 seconds.

The Pi will reboot automatically.

You should be able to reconnect after ~1 minute.

4. Troubleshooting

Status Check:
To see if the watchdog is currently running:

code
Bash
download
content_copy
expand_less
sudo systemctl status watchdog

Stop Watchdog (For maintenance):
If you need to perform heavy updates and don't want accidental reboots:

code
Bash
download
content_copy
expand_less
sudo systemctl stop watchdog
code
Code
download
content_copy
expand_less