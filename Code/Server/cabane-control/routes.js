const express = require('express');
const router = express.Router();

// Load Modules
const authRoutes = require('./routes_split/auth');
const noteRoutes = require('./routes_split/notes');
const messageRoutes = require('./routes_split/messaging');
const adminRoutes = require('./routes_split/admin');

// Combine
router.use(authRoutes);
router.use(noteRoutes);
router.use(messageRoutes);
router.use(adminRoutes);

module.exports = router;