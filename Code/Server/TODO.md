# Development Roadmap & TODO

## Phase 1: Server Infrastructure (Completed)
- [x] **Hardware:** Pi Zero 2 W setup.
- [x] **OS:** Raspberry Pi OS Lite installed.
- [x] **Environment:** Node.js, SQLite installed.
- [x] **Database:** `users`, `logs`, `messages` tables created + Auto-cleanup task.

## Phase 2: Backend Logic (Node.js) (Completed)
- [x] **UDP Service:** v5 (Global Sync `0xBB`, Broadcast Feedback `0xAC`, Remote Data `0xB0`).
- [x] **Logic Engine:**
    - [x] v9 "Stubborn Mode" (Aggressive Assertion).
    - [x] Independent Logic (Thermostats, Vacuum Alarms, Buzzer Timing).
    - [x] Heartbeat Monitor (Headless Failsafe).

## Phase 3: Firmware Updates (Completed)
- [x] **Station Controller:**
    - [x] Broadcast Feedback/Heartbeats to `.255`.
    - [x] Dynamic Master Logic.
    - [x] Analog Ladder Input (Pin A6).
    - [x] Optimized RX/Display Loops.
- [x] **Main Controller:**
    - [x] Override Logic (Slave Mode).
    - [x] Physical State Broadcast (`0xB1`).
    - [x] Global Command Sender (`0xBB`).
    - [x] Emergency Release (Buttons 0+1).

## Phase 4: API & Websockets (Completed)
- [x] **Express API:** Auth (Register/Login/Email), Admin, Control, Messaging.
- [x] **Email Service:** Nodemailer (Gmail SMTP).

## Phase 5: Frontend (React) (Completed)
- [x] **Setup:** Vite + React + Tailwind CSS.
- [x] **UI Components:**
    - [x] Station Panel Grid (Responsive).
    - [x] Industrial Rocker Switch (Dark/Light modes).
    - [x] Halo Button.
    - [x] Notification Banners (Alarm/Info).
    - [x] Station Card (Offline Timers, Dynamic Backgrounds).
- [x] **Logic:**
    - [x] Auth Guard (Splash Screen / Login / Dashboard).
    - [x] Control Handover (Take / Release Server / Release Cabane).
    - [x] Audio/Vibration Alerts.
    - [x] User Settings (Local Storage).
    - [x] Admin Panel (Approve/Delete Users).
- [x] **Deployment:** Built and served via Node `express.static`.

## Phase 6: Remote Access & Mobile (Current)
- [ ] **Remote Access:** Configure Cloudflare Tunnel (Bypasses Starlink CGNAT).
- [ ] **Mobile App:** Wrap React app with CapacitorJS (Optional, browser works well).
- [ ] **Biometrics:** Enable FaceID (Requires Capacitor).