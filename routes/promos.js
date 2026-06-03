// Promo / discount codes (staff CRUD) + gift-card visibility.
const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLog } = require('../lib/audit');

const router = express.Router();
router.use(verifyToken);

// List promo codes (owner: all; manager: their location + global).
router.get('/', requireRole('owner', 'manager'), (req, res) => {
  let rows;
  if (req.user.role === 'owner') rows = db.prepare(`SELECT * FROM promo_codes ORDER BY is_active DESC, created_at DESC`).all();
  else rows = db.prepare(`SELECT * FROM promo_codes WHERE location_id IS NULL OR location_id=? ORDER BY is_active DESC, created_at DESC`).all(req.user.location_id);
  res.json(rows);
});

router.post('/', requireRole('owner', 'manager'), (req, res) => {
  const code = (req.body.code || '').toString().trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Code required' });
  const kind = req.body.kind === 'amount' ? 'amount' : 'percent';
  const value = Math.max(0, parseFloat(req.body.value) || 0);
  if (kind === 'percent' && value > 100) return res.status(400).json({ error: 'Percent cannot exceed 100.' });
  // Managers can only create codes scoped to their own location.
  const location_id = req.user.role === 'manager' ? req.user.location_id : (req.body.location_id || null);
  try {
    const r = db.prepare(`INSERT INTO promo_codes (code, kind, value, min_subtotal, starts_at, ends_at, usage_limit, location_id) VALUES (?,?,?,?,?,?,?,?)`)
      .run(code, kind, value, Math.max(0, parseFloat(req.body.min_subtotal) || 0),
           req.body.starts_at || null, req.body.ends_at || null,
           req.body.usage_limit != null && req.body.usage_limit !== '' ? parseInt(req.body.usage_limit) : null, location_id || null);
    auditLog(req, 'promo_create', 'promo', r.lastInsertRowid, { code, kind, value });
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'That code already exists.' });
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

router.put('/:id', requireRole('owner', 'manager'), (req, res) => {
  const p = db.prepare(`SELECT * FROM promo_codes WHERE id=?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Promo not found' });
  if (req.user.role === 'manager' && p.location_id !== req.user.location_id) return res.status(403).json({ error: 'Not your location.' });
  const fields = [], vals = [];
  ['value', 'min_subtotal'].forEach(k => { if (req.body[k] !== undefined) { fields.push(`${k}=?`); vals.push(Math.max(0, parseFloat(req.body[k]) || 0)); } });
  if (req.body.is_active !== undefined) { fields.push('is_active=?'); vals.push(req.body.is_active ? 1 : 0); }
  if (req.body.ends_at !== undefined)   { fields.push('ends_at=?');   vals.push(req.body.ends_at || null); }
  if (req.body.usage_limit !== undefined) { fields.push('usage_limit=?'); vals.push(req.body.usage_limit === '' || req.body.usage_limit == null ? null : parseInt(req.body.usage_limit)); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(p.id);
  db.prepare(`UPDATE promo_codes SET ${fields.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});

router.delete('/:id', requireRole('owner', 'manager'), (req, res) => {
  const p = db.prepare(`SELECT * FROM promo_codes WHERE id=?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Promo not found' });
  if (req.user.role === 'manager' && p.location_id !== req.user.location_id) return res.status(403).json({ error: 'Not your location.' });
  db.prepare(`DELETE FROM promo_codes WHERE id=?`).run(p.id);
  res.json({ success: true });
});

// Issued gift cards (owner/manager view).
router.get('/giftcards', requireRole('owner', 'manager'), (req, res) => {
  res.json(db.prepare(`SELECT code, initial_amount, balance, status, recipient_email, created_at FROM gift_cards ORDER BY created_at DESC LIMIT 200`).all());
});

module.exports = router;
