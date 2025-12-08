require('dotenv').config({ path: __dirname + '/test.env' }); // Load .env
const { io } = require('socket.io-client');
const axios = require('axios');

// Load Config from Env
const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'cabane';

let tokenAdmin = null;
let tokenSender = null;
let tokenReceiver = null;

async function setup() {
    console.log(`--- SETUP (${BASE_URL}) ---`);

    // 1. Login as Admin
    try {
        const resAdmin = await axios.post(`${BASE_URL}/api/auth/login`, { username: ADMIN_USER, password: ADMIN_PASS });
        tokenAdmin = resAdmin.data.token;
        console.log("✔ Admin Logged In");
    } catch (e) {
        console.error("❌ Admin Login Failed. Check credentials in test.env");
        process.exit(1);
    }

    // 2. Create & Approve Users
    tokenSender = await createAndApproveUser('Sender', 'sender@test.com');
    tokenReceiver = await createAndApproveUser('Receiver', 'receiver@test.com');
}

async function createAndApproveUser(username, email) {
    try {
        await axios.post(`${BASE_URL}/api/auth/register`, { username, email, password: 'Password1!' });
    } catch (e) { } // Ignore if exists

    // Find User ID (as Admin)
    const resUsers = await axios.get(`${BASE_URL}/api/users`, { headers: { Authorization: `Bearer ${tokenAdmin}` } });
    const user = resUsers.data.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) throw new Error(`Could not find user ${username}`);

    // Approve
    if (user.status !== 'ACTIVE') {
        await axios.post(`${BASE_URL}/api/users/approve`, { userId: user.id }, { headers: { Authorization: `Bearer ${tokenAdmin}` } });
        console.log(`[Setup] Approved ${username}`);
    }

    // Login
    const resLogin = await axios.post(`${BASE_URL}/api/auth/login`, { username, password: 'Password1!' });
    return resLogin.data.token;
}

async function testOrdering() {
    console.log("\n--- TEST: ORDERING & OPTIMISTIC UI ---");

    const socketSender = io(BASE_URL);

    const waitForMessage = (sock) => new Promise(resolve => {
        sock.on('NEW_MESSAGE', (msg) => resolve(msg));
    });

    const tempId = `temp-${Date.now()}`;
    const payload = { content: "Test Ordering", tempId };

    console.log(`[Sender] Sending: ${payload.content}`);

    const sendPromise = axios.post(`${BASE_URL}/api/messages`, payload, { headers: { Authorization: `Bearer ${tokenSender}` } });
    const receivePromise = waitForMessage(socketSender);

    const [res, msg] = await Promise.all([sendPromise, receivePromise]);

    if (msg.tempId === tempId) console.log("✅ PASS: Server echoed tempId.");
    else console.error("❌ FAIL: No tempId echo.");

    if (msg.timestamp) console.log(`✅ PASS: Server returned unified timestamp: ${msg.timestamp}`);

    socketSender.close();
}

async function run() {
    await setup();
    await testOrdering();
}

run().catch(console.error);