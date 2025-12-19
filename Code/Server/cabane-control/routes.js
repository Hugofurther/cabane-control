const express = require('express');
const router = express.Router();

// Load Modules
const authRoutes = require('./routes_split/auth');
const noteRoutes = require('./routes_split/notes');
const messageRoutes = require('./routes_split/messaging');
const adminRoutes = require('./routes_split/admin');
const simulationRoutes = require('./routes_split/simulation');
const automationRoutes = require('./routes_split/automation'); // ✅ Check this

// Combine
router.use(authRoutes);
router.use(noteRoutes);
router.use(messageRoutes);
router.use(adminRoutes);
router.use(simulationRoutes);
router.use(automationRoutes); // ✅ And this

module.exports = router;