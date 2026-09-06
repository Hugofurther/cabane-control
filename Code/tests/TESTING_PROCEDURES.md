# Testing Procedures

This document outlines the test cases for the Cabane Control system.

## Test Case 1: Headless Recovery

**Objective:** Verify that the server (Pi) can take control of the system when the main controller goes offline and that the main controller can regain control when it comes back online.

**Steps:**

1.  Start the entire system: main controller, station controllers, and server.
2.  Verify that the main controller has control. The web UI should show "MASTER: CABANE".
3.  Disconnect the main controller from the network.
4.  Wait for the server to detect that the main controller is offline. The web UI should show "MASTER: SERVER" or "MASTER: USER" with "SYSTEM_FAILSAFE".
5.  Reconnect the main controller to the network.
6.  Verify that the main controller regains control. The web UI should show "MASTER: CABANE".

**Expected Result:** The system should seamlessly transition between the main controller and the server being the master controller, with no loss of functionality.

## Test Case 2: Messaging

**Objective:** Verify that the urgent messaging system works as expected.

**Steps:**

1.  Log in to the web UI with two different users (User A and User B) on two different browsers or devices.
2.  User A sends an "Urgent Flash Message" to User B.
3.  Verify that User B receives a full-screen popup with the message.
4.  User B acknowledges the message by clicking the "Dismiss" button.
5.  Verify that the message is no longer shown as a popup for User B.
6.  Verify that the message is no longer marked as urgent for both User A and User B in the message drawer.

**Expected Result:** Urgent messages should be clearly visible to the recipient and should be acknowledged to be dismissed.
