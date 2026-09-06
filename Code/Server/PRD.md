# Product Requirements Document (PRD)
## Project: Cabane Control IoT System (v3 - Dual Master)

### 1. Introduction
The objective is to expand an existing Arduino-based SCADA system for a Maple Syrup Farm into a secure, accessible, and **redundant** IoT solution. A Raspberry Pi Zero server will act as a secondary Master Controller, allowing authorized users to monitor status and assume full control via a Web/Mobile application.

### 2. System Architecture
*   **Topology:** Dual Master (Main Controller & Pi Server).
*   **Main Controller:** Arduino Mega 2560. Primary Master.
*   **Station Controllers:** Arduino Nano + W5500. Passive execution units.
    *   **Feedback:** Stations broadcast feedback to `192.168.1.255` so all controllers see status simultaneously.
    *   **Commands:** Stations accept commands from whichever Master is active.
*   **IoT Server:** Raspberry Pi Zero 2 W + Ethernet Shield. Secondary Master.
    *   **Role:** Hosting Web App, Logging, and acting as Remote Controller.

### 3. User Roles & Authentication
*   **Administrator:** Can approve/reject new accounts via Email Link.
*   **Operator:** Can view status, send messages, and request control override.
*   **Authentication:**
    *   Web: Password + Optional 2FA.
    *   Mobile: Biometric (FaceID/TouchID) after initial login.

### 4. Control Logic & Authority Rules

#### 4.1 Master Priority Rule
*   **Main Controller (Physical)** is the default Master.
*   **Pi Server (Virtual)** can request to become Master ("Override").
*   **Mutual Exclusion:** Only **one** device sends commands to Stations at any given time.

#### 4.2 Transitions
*   **Main Controller Boot:** Automatically assumes Master status (Safety requirement).
*   **Pi Server Boot:**
    *   If Main Controller detected: Stays in Passive (Monitor) Mode.
    *   If Main Controller NOT detected: Pi assumes Master status (Headless Mode) based on last known state.
*   **Taking Control (Remote):**
    *   User clicks "Take Control" -> Pi sends `OVERRIDE_ENABLE` to Main Controller.
    *   Main Controller acknowledges, stops sending commands, and enters "Slave Mode".
    *   Pi begins sending commands directly to Stations.
*   **Releasing Control (Remote):**
    *   User clicks "Release" -> Pi sends `OVERRIDE_DISABLE` to Main Controller.
    *   Pi stops sending commands. Main Controller resumes sending commands based on physical switches.
*   **Forced Reclaim (Physical):**
    *   Operator holds **Switch 0 + 1** for 2 seconds.
    *   Main Controller forces itself to Master, ignores Pi, and resumes command.

#### 4.3 Synchronization
*   **Main -> Pi:** Main Controller *always* broadcasts physical switch positions (Packet `0xB1`). Pi uses this to show "Ghost Switches" on UI (shadow indicators showing where the physical switch is).
*   **Pi -> Main:** Pi sends nothing regarding switches. It only sends the Override Flag.
*   **Feedback:** Both controllers listen to Station Broadcasts (`0xAC`) to drive their respective LEDs/GUI indicators.

#### 4.4 Disconnect Behavior
*   **Main Offline:** Pi automatically detects loss (Heartbeat timeout) and takes control to keep system running.
*   **Pi Offline / User Logout:**
    *   If a user logs out without releasing, the Pi **holds the last state**. Control remains with the Pi until a new user logs in or the Main Controller forces a reclaim.

### 5. User Interface (GUI) Specifications

#### 5.1 Dashboard
*   **Header:** Shows "Controller: Cabane" or "Controller: [Username]".
*   **Station Grid:**
    *   **Desktop:** Full Panel Replica.
    *   **Mobile:** Station Blocks. Click -> Full Screen Modal.
*   **Visual Feedback:**
    *   **Virtual Switch:** Shows current command state.
    *   **Ghost Indicator:** If Pi is in control, a small "Ghost" icon shows the actual physical position of the Main Controller switch (so user knows what will happen if they release).

#### 5.2 Safety Warnings
*   **Release Warning:** If Virtual State != Physical State, popping up a warning: *"Releasing control will change Pump 1 to OFF. Confirm?"*

### 6. Logging & Data
*   **Database:** SQLite.
*   **Activity Log:** Records Timestamp, User, Action (Login, Take Control, Switch Toggle).
*   **Constraint:** Only log *changes* in state.

### 7. Hardware Requirements (Updated)
*   **Main Controller:**
    *   Override Indicator: Thermostat/Buzzer LEDs blink GREEN when in Slave Mode.
    *   Buzzer: Sounds alarm based on broadcast feedback regardless of Mode.
*   **Stations:**
    *   Broadcast Feedback to `*.255`.