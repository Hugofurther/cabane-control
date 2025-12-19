const express = require('express');
const router = express.Router();

const authRoutes = require('./routes_split/auth');
const noteRoutes = require('./routes_split/notes');
const messageRoutes = require('./routes_split/messaging');
const adminRoutes = require('./routes_split/admin');
const autoRoutes = require('./routes_split/automation'); // ✅ NEW
const simRoutes = require('./routes_split/simulation'); // ✅ NEW

router.use(authRoutes);
router.use(noteRoutes);
router.use(messageRoutes);
router.use(adminRoutes);
router.use(autoRoutes); // ✅ NEW
router.use(simRoutes); // ✅ NEW

module.exports = router;