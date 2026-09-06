# Cabane Control - Messaging System Documentation

## 1. System Overview
The Messaging System is a real-time communication module integrated into the Cabane Control Dashboard. It serves two purposes:
1.  **Collaboration:** Allowing operators to coordinate via Global Chat, Private DMs, and Groups.
2.  **Alerting:** Providing a high-priority "Flash Message" channel for urgent operational instructions that must be acknowledged by operators.

---

## 2. Component: MessageDrawer.jsx
The `MessageDrawer` is the primary interface for communication. It slides out from the right side of the screen, allowing users to chat while maintaining visibility of the Station Controls in the background.

### A. Data Architecture & Sync
*   **Hybrid Fetching:**
    *   **Initial Load:** Fetches the last 100 messages via REST API (`GET /messages`).
    *   **Live Updates:** Listens for WebSocket events (`NEW_MESSAGE`, `UPDATE_MESSAGE`, `DELETE_MESSAGE`) for sub-second latency.
    *   **Polling Backup:** Re-fetches data every 4 seconds to ensure consistency in case of packet loss.
*   **Optimistic UI:** When sending, messages appear instantly with a temporary ID. Once the server confirms receipt via Socket, the temporary message is silently swapped for the permanent one without visual flickering.

### B. Smart Scroll Engine
The drawer implements a complex "Sticky Bottom" logic to handle incoming messages without disrupting the user:
1.  **Scenario: User is at the bottom.**
    *   New message arrives.
    *   Logic detects user is "live".
    *   Drawer auto-scrolls to show the new message immediately.
2.  **Scenario: User is reading history (scrolled up).**
    *   New message arrives.
    *   Logic detects user is "busy".
    *   Drawer **does not move**. A floating **"New Messages ↓"** button appears.
3.  **Scenario: Opening a Thread.**
    *   Logic identifies the **First Unread Message**.
    *   Drawer jumps to center that message in the view, ensuring the user sees the start of what they missed.

### C. Read Receipts & Badges
*   **Per-User Tracking:** Read status is tracked individually (`is_read_by_me`).
*   **Trigger:** Messages are marked as read only when they are rendered in the viewport and the drawer is open.
*   **Badges:**
    *   **Main Icon:** Shows total unread count for the user.
    *   **Tabs:** Shows unread count per category (Global, Users, Groups).
    *   **Lists:** Shows unread count specific to that User or Group.

---

## 3. Component: FlashViewer.jsx
The `FlashViewer` is a high-priority modal overlay. It allows users to view messages in a large, focused format.

### A. Visual Style
*   **Backdrop:** 35% Opacity Black with a 0.75px Blur. This dims the dashboard to focus attention while keeping the station status visible for safety.
*   **Frame:** High-contrast borders. **Red** for Urgent/Flash messages, **Blue** for standard Zoom interactions.
*   **Stacking:** Handles multiple active messages as a "Stack". Users can navigate through them using Next/Prev arrows.

### B. Modes of Operation
1.  **Auto-Popup (Urgent):**
    *   Triggered automatically by `App.jsx` when an unacknowledged Flash Message exists for the logged-in user.
    *   Action Button: **"ACKNOWLEDGE"**. This marks the message read and downgrades its urgency for *this specific user*.
2.  **Zoom View (Manual):**
    *   Triggered by clicking any message bubble in the `MessageDrawer`.
    *   Action Button: **"CLOSE"**. Simply closes the modal.

---

## 4. Feature Focus: Flash Message Lifecycle

Flash Messages ("Urgent") have unique logic to ensure critical information is seen by **every** intended recipient.

### A. Sending
*   A sender toggles **"FLASH MESSAGE"** before sending.
*   The message is saved to the database with `priority = 'URGENT'`.
*   **Sender View:** The message pulses RED in the chat thread. It remains RED until the "All Acknowledged" condition is met.

### B. Receiving
*   Recipients see the `FlashViewer` popup immediately.
*   The message pulses RED in their chat thread.
*   **Badge:** An "Unread" badge persists until the message is Acknowledged.

### C. Acknowledgment Logic (The "All Users" Rule)
1.  **Individual Ack:** When a Recipient clicks "Acknowledge", the message visually downgrades to "Normal" (Blue/Grey) *for that user only*.
2.  **Global Resolution:**
    *   The Server tracks a list of acknowledgments for the message ID.
    *   **Condition:** `Count(Acknowledgments) == Count(Group Members - Sender)`.
    *   The message priority remains `URGENT` in the database until **ALL** recipients have acknowledged it.
    *   Once the final recipient acknowledges, the Server downgrades the message to `NORMAL` globally.
3.  **Sender Feedback:**
    *   The Sender's copy stops pulsing RED only when the global downgrade occurs. This gives the Sender confirmation that **everyone** has seen the instruction.

### D. Header Info (FlashViewer)
When viewing a Flash Message, the Header displays context about the acknowledgment status:
*   **Status Badge:** "WAITING FOR ACKS" vs "RESOLVED".
*   **Expandable Lists:**
    *   **Acknowledged:** List of users who have dismissed the popup.
    *   **Pending:** List of users who have *not* yet seen/dismissed the message.