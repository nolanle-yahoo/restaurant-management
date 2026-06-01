const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const rateLimit = require('express-rate-limit');
const db      = require('../db/database');
const { verifyToken } = require('../middleware/auth');
const { sendEmail } = require('../lib/email');

const router = express.Router();

// Minimum password length (used on change and reset).
const MIN_PASSWORD = 8;

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

// Throttle password-change attempts to slow current-password guessing. Keyed by
// user id (not IP) so staff sharing a restaurant's public IP aren't collectively
// locked out.
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id ? `u${req.user.id}` : req.ip),
  message: { error: 'Too many password-change attempts. Please try again later.' },
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
    { id: user.id, role: user.role, location_id: user.location_id, name: user.name, tv: user.token_version || 0 },
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
  // Changing the password revokes all OTHER sessions; issue a fresh token so
  // the current session keeps working.
  db.prepare(`UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?`).run(bcrypt.hashSync(new_password, 10), req.user.id);
  const newTv = db.prepare(`SELECT token_version FROM users WHERE id=?`).get(req.user.id).token_version;
  const token = jwt.sign(
    { id: user.id, role: user.role, location_id: user.location_id, name: user.name, tv: newTv },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  res.json({ success: true, token });
});

// Log out everywhere: invalidate every issued token for this user, then mint a
// fresh one so the current device stays signed in.
router.post('/logout-all', verifyToken, (req, res) => {
  db.prepare(`UPDATE users SET token_version=token_version+1 WHERE id=?`).run(req.user.id);
  const user = db.prepare(`SELECT id, role, location_id, name, token_version FROM users WHERE id=?`).get(req.user.id);
  const token = jwt.sign(
    { id: user.id, role: user.role, location_id: user.location_id, name: user.name, tv: user.token_version },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  res.json({ success: true, token, message: 'All other sessions have been signed out.' });
});

// ── Forgot / reset password ──────────────────────────────────
// Always returns a generic success to avoid leaking which emails exist.
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const { email } = req.body;
  const generic = { success: true, message: 'If that email is registered, a reset link has been sent.' };
  if (!email) return res.json(generic);

  const user = db.prepare(`SELECT id, name FROM users WHERE email=? AND is_active=1`).get(email.trim());
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19); // 1 hour
    db.prepare(`INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?,?,?)`).run(user.id, token, expires);
    const base = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
    const link = `${base}/reset.html?token=${token}`;
    await sendEmail(email.trim(),
      'Reset your Restaurant Management password',
      `Hi ${user.name},\n\nWe received a request to reset your password.\n\n` +
      `Reset it here (valid for 1 hour):\n${link}\n\n` +
      `If you didn't request this, you can ignore this email.`,
      'password_reset');
  }
  res.json(generic);
});

router.post('/reset-password', resetLimiter, (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) return res.status(400).json({ error: 'token and new_password required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const row = db.prepare(`SELECT * FROM password_reset_tokens WHERE token=?`).get(token);
  if (!row || row.used) return res.status(400).json({ error: 'This reset link is invalid or has already been used.' });
  if (new Date(row.expires_at + 'Z') < new Date()) return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });

  // A reset revokes all existing sessions for that account.
  db.prepare(`UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?`).run(bcrypt.hashSync(new_password, 10), row.user_id);
  db.prepare(`UPDATE password_reset_tokens SET used=1 WHERE id=?`).run(row.id);
  res.json({ success: true, message: 'Password updated. You can now sign in.' });
});

module.exports = router;
