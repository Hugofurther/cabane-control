
# GEMINI.md
🌲 Project: Cabane Control System (Maple Syrup Farm SCADA)
1. Context & Architecture

This is a distributed IoT system controlling pumping stations for a maple syrup farm. The system must operate with high availability, redundancy, and offline fail-safes.

The system consists of three distinct nodes:

Main Controller (Arduino Mega):

Role: Primary Master (Physical Controls).

Input: 24 Physical Switches.

Output: UDP Broadcast (0xBB Global Command).

Logic: Defaults to Master. Enters "Slave Mode" when commanded by Server. Restores Master on physical interaction or reboot.

Station Controllers (Arduino Nano + W5500):

Role: Execution Units (Relays) & Sensors (Feedback).

Logic: "Dynamic Master". Listens for 0xBB commands. Broadcasts feedback (0xAC) to 255.255.255.255 so both Main and Server see status.

Server (Raspberry Pi Zero 2 W):

Role: Secondary Master (Virtual Controls), Logging, Web Host.

Stack: Node.js (Backend), SQLite (DB), React + Tailwind (Frontend).

Logic: Runs a State Machine (logic_engine.js) that mimics the Main Controller. Takes control via UDP (0xAF).

2. Directory Structure & Key Files
code
Text
download
content_copy
expand_less
.
├── Main/Main_Controller/Main_Controller.ino   # Arduino Mega Firmware (Dual Master Logic)
├── Stations/Station_Controller/Station_Controller.ino # Arduino Nano Firmware (Broadcast Feedback)
├── Server/
│   ├── cabane-control/                        # Node.js Backend
│   │   ├── server.js                          # Entry point (Express, Socket.io, Static Serve)
│   │   ├── routes.js                          # API Endpoints (Auth, Control, Users, Logs)
│   │   ├── setup_db.js                        # SQLite Schema Init
│   │   └── services/
│   │       ├── logic_engine.js                # CORE BRAIN: State Machine, UDP Logic, Thermostat Logic
│   │       ├── udp_service.js                 # Network Layer (Sends 0xBB, 0xAF, Parses 0xAC)
│   │       └── weather_service.js             # Server-side caching for Open-Meteo API
│   └── frontend/cabane-ui/                    # React Frontend
│       ├── src/
│       │   ├── App.jsx                        # Main Layout & Global State Consumers
│       │   ├── contexts/SocketContext.jsx     # Global State Management (Socket.io + Auth)
│       │   ├── components/
│       │   │   ├── StationCard.jsx            # Visualization of Pumps/Vacuums
│       │   │   ├── MessageDrawer.jsx          # Complex Chat System (Global, DM, Group)
│       │   │   ├── FlashViewer.jsx            # High-priority Full-screen Message Alert
│       │   │   ├── AdminPanel.jsx             # User Management & System Settings
│       │   │   ├── LogViewer.jsx              # System Logs with Filters & Export
│       │   │   └── Weather.jsx                # Visual Weather Widget
│       │   └── config/stations.js             # UI Layout Configuration
3. Current Implementation Logic
A. Dual Master Protocol (UDP)

Packet 0xBB (Global Sync): Sent by the Active Master (Main or Pi). Contains 10 bytes: Header, MasterID, and 6 bytes of Relay States for stations. Sent to Broadcast .255.

Packet 0xAC (Feedback): Sent by Stations to Broadcast .255.

Packet 0xB1 (Physical State): Sent by Main Controller to Broadcast. Contains physical switch positions so the App can show "Ghost" indicators.

Override Logic: Pi sends 0xAF (Take Control). Main acknowledges and stops sending 0xBB. Main resumes if buttons 0+1 are held or if it reboots.

B. Messaging System

Structure: SQL-based. Supports Global, Notes (Self), DMs, and Groups.

Read Status: Per-user tracking via message_reads table.

Urgency: Messages can be "URGENT". They flash red and trigger a system siren (App audio) until acknowledged.

Flash Viewer: Urgent messages force a full-screen popup overlay.

C. Frontend Architecture

Context: SocketContext holds the "God Object" (systemState) synced via WebSockets.

Visuals: Industrial design using Tailwind. Dynamic styling based on Control Mode (Dark = Monitoring, Light Grey = Driving).

4. Mission Instructions (The Prompt)

Role: You are a Senior Full Stack Engineer and Embedded Systems Architect.

Objective: Finalize the "Cabane Control" application, focusing on stability, mobile responsiveness, and code cleanup.

Step 1: Evaluation & Audit

Analyze src/components/MessageDrawer.jsx for scroll glitches. Specifically, verify the useLayoutEffect logic for "Sticky Bottom" scrolling ensures new messages appear instantly without jitter.

Review services/logic_engine.js (Backend) to ensure the "Polite Mode" handshake (Release to Cabane) correctly handles the case where the Main Controller is offline.

Check src/contexts/SocketContext.jsx to ensure all state variables (especially weatherData and onlineList) are exported correctly.

Step 2: Final Feature Implementation

Mobile Optimization: Ensure StationCard click behavior on mobile opens a modal (to prevent fat-finger errors) if not already implemented.

Deployment Prep: Check vite.config.js and package.json for proper build scripts.

Error Boundaries: Suggest or implement React Error Boundaries to prevent the "White Screen of Death" if a component (like Weather) receives malformed data.

Step 3: Testing Procedures

Define a test case for "Headless Recovery": Main Controller unplugs 
→
→
 Pi takes control 
→
→
 Main Controller replugs 
→
→
 Main Controller retakes control.

Define a test case for "Messaging": User A sends Urgent Flash Message 
→
→
 User B receives Popup 
→
→
 User B acknowledges 
→
→
 Message becomes Normal for both.

5. Development Standards & Philosophy

Code Modification Rules:

Minimal Intervention: When changing code, only modify the strict necessary lines. Do not refactor surrounding logic unless it is broken.

Preserve Stability: Avoid breaking working code. The system is currently live and functional; regressions are unacceptable.

Test Organization: Keep all test files in a separate folder (e.g., tests/ or __tests__/). Do not clutter the source directories.

Workflow: Test Driven Development (TDD):
When implementing a new feature or fixing a complex bug, follow this cycle:

Write the Test First: Create a test script (Unit or Integration) that defines the expected behavior.

Fail: Run the test to confirm it fails (validating the test checks the right thing).

Implement: Write the code to pass the test.

Refactor: Clean up the code while ensuring the test still passes.

Commands:

Prioritize Robustness (handling undefined, network timeouts) over new features.

Maintain the Industrial UI aesthetic (High contrast, large touch targets).