const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db/database');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare(`
    SELECT u.*, l.name as location_name FROM users u
    LEFT JOIN locations l ON u.location_id = l.id
    WHERE u.email = ? AND u.is_active = 1
  `).get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, location_id: user.location_id, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, location_id: user.location_id, location_name: user.location_name }
  });
});

router.get('/me', verifyToken, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.location_id, l.name as location_name
    FROM users u LEFT JOIN locations l ON u.location_id = l.id WHERE u.id = ?
  `).get(req.user.id);
  res.json(user);
});

module.exports = router;
