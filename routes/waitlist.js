// Walk-in waitlist — a host queue alongside reservations.
const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { broadcast } = require('../lib/ws');
const { sendSMS } = require('../lib/sms');
const tg = require('../lib/telegram');

const router = express.Router();
router.use(verifyToken);
const HOST = ['owner', 'manager', 'frontdesk'];

// Current (waiting) parties for the location.
router.get('/', requireRole(...HOST), (req, res) => {
  const locId = req.user.role === 'owner' ? (req.query.location_id || null) : req.user.location_id;
  const where = locId ? 'WHERE location_id=? AND status=\'waiting\'' : 'WHERE status=\'waiting\'';
  const args = locId ? [locId] : [];
  res.json(db.prepare(`SELECT * FROM waitlist ${where} ORDER BY created_at`).all(...args));
});

router.post('/', requireRole(...HOST), (req, res) => {
  const locId = req.user.role === 'owner' ? req.body.location_id : req.user.location_id;
  const { guest_name, party_size, phone, quoted_minutes, notes } = req.body;
  if (!locId || !guest_name) return res.status(400).json({ error: 'Location and guest name are required.' });
  const size = Math.max(1, Math.min(50, parseInt(party_size) || 2));
  const r = db.prepare(`INSERT INTO waitlist (location_id, guest_name, party_size, phone, quoted_minutes, notes) VALUES (?,?,?,?,?,?)`)
    .run(locId, String(guest_name).slice(0, 120), size, phone || null, parseInt(quoted_minutes) || null, notes ? String(notes).slice(0, 300) : null);
  broadcast('waitlist_update', { location_id: Number(locId) }, locId);
  res.json({ success: true, id: r.lastInsertRowid });
});

// Update status: seat or remove (left).
router.put('/:id', requireRole(...HOST), (req, res) => {
  const w = db.prepare(`SELECT * FROM waitlist WHERE id=?`).get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Waitlist entry not found' });
  if (req.user.role !== 'owner' && w.location_id !== req.user.location_id) return res.status(403).json({ error: 'Not your location.' });
  const status = ['waiting', 'seated', 'left'].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Invalid status' });
  const seatedAt = status === 'seated' ? "datetime('now')" : 'seated_at';
  db.prepare(`UPDATE waitlist SET status=?, seated_at=${seatedAt} WHERE id=?`).run(status, w.id);
  broadcast('waitlist_update', { location_id: w.location_id }, w.location_id);
  res.json({ success: true });
});

// Page the guest that their table is ready (texts them if a phone is on file).
router.post('/:id/notify', requireRole(...HOST), (req, res) => {
  const w = db.prepare(`SELECT * FROM waitlist WHERE id=?`).get(req.params.id);
  if (!w) return res.status(404).json({ error: 'Waitlist entry not found' });
  if (req.user.role !== 'owner' && w.location_id !== req.user.location_id) return res.status(403).json({ error: 'Not your location.' });
  if (w.status !== 'waiting') return res.status(409).json({ error: 'This party is no longer waiting.' });
  db.prepare(`UPDATE waitlist SET notified_at=datetime('now') WHERE id=?`).run(w.id);
  const locName = (db.prepare(`SELECT name FROM locations WHERE id=?`).get(w.location_id) || {}).name || 'your restaurant';
  if (w.phone) sendSMS(w.phone, `${locName}: your table is ready! Please see the host. 🍽️`, 'waitlist');
  tg.sendTelegram(`🔔 Paged waitlist guest ${w.guest_name} (party of ${w.party_size}) — table ready at ${locName}`, 'waitlist');
  broadcast('waitlist_update', { location_id: w.location_id }, w.location_id);
  res.json({ success: true });
});

module.exports = router;
