const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const rateLimit = require('express-rate-limit');
const db      = require('../db/database');
const { verifyToken } = require('../middleware/auth');
const { sendEmail } = require('../lib/email');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

router.post('/login', loginLimiter, (req, res) => {
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

router.put('/profile', verifyToken, (req, res) => {
  const { name, email } = req.body;
  if (!name && !email) return res.status(400).json({ error: 'name or email required' });
  const fields = [], vals = [];
  if (name)  { fields.push('name=?');  vals.push(name.trim()); }
  if (email) { fields.push('email=?'); vals.push(email.trim()); }
  vals.push(req.user.id);
  try {
    db.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).run(...vals);
    // Return updated user for localStorage refresh
    const updated = db.prepare(`SELECT u.id,u.name,u.email,u.role,u.location_id,l.name as location_name FROM users u LEFT JOIN locations l ON u.location_id=l.id WHERE u.id=?`).get(req.user.id);
    res.json({ success: true, user: updated });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

router.put('/password', verifyToken, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ success: true });
});

module.exports = router;
