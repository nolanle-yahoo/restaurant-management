// Public, unauthenticated endpoints for the customer-facing site
// (menu browsing + online reservation requests). No JWT required.

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { broadcast } = require('../lib/ws');
const { sendEmail } = require('../lib/email');

const router = express.Router();

// Short, human-friendly confirmation/receipt code (e.g. "RSV-7K3Q2H")
function makeCode(prefix) {
  return prefix + '-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

// Active locations (minimal public fields)
router.get('/locations', (req, res) => {
  const rows = db.prepare(`SELECT id, name, address, phone FROM locations WHERE status='active' ORDER BY name`).all();
  res.json(rows);
});

// Public menu for a location: categories with their available items
router.get('/menu', (req, res) => {
  const locId = req.query.location_id;
  if (!locId) return res.status(400).json({ error: 'location_id required' });
  const location = db.prepare(`SELECT id, name FROM locations WHERE id=? AND status='active'`).get(locId);
  if (!location) return res.status(404).json({ error: 'Location not found' });
  const categories = db.prepare(`SELECT id, name FROM menu_categories WHERE location_id=? AND is_active=1 ORDER BY sort_order, name`).all(locId);
  const items = db.prepare(`
    SELECT id, category_id, name, description, price
    FROM menu_items WHERE location_id=? AND is_available=1
    ORDER BY sort_order, name
  `).all(locId);
  const menu = categories.map(c => ({ ...c, items: items.filter(i => i.category_id === c.id) }))
                         .filter(c => c.items.length);
  res.json({ location, menu });
});

// Throttle public booking submissions per IP
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many booking attempts. Please try again later.' },
});

// Online reservation request → always created as 'pending' for staff approval
router.post('/reservations', bookingLimiter, (req, res) => {
  const { location_id, guest_name, guest_phone, guest_email, party_size, reservation_date, reservation_time, notes } = req.body;
  if (!location_id || !guest_name || !party_size || !reservation_date || !reservation_time) {
    return res.status(400).json({ error: 'Name, location, party size, date and time are required' });
  }
  const loc = db.prepare(`SELECT id FROM locations WHERE id=? AND status='active'`).get(location_id);
  if (!loc) return res.status(404).json({ error: 'Location not found' });

  const size = Math.max(1, Math.min(50, parseInt(party_size) || 1));
  const r = db.prepare(`
    INSERT INTO reservations (location_id, guest_name, guest_phone, guest_email, party_size,
      reservation_date, reservation_time, status, notes)
    VALUES (?,?,?,?,?,?,?,'pending',?)
  `).run(location_id, String(guest_name).slice(0,120), guest_phone || null, guest_email || null,
         size, reservation_date, reservation_time, notes ? String(notes).slice(0,500) : null);

  broadcast('reservation_update', { location_id: Number(location_id) }, location_id);
  res.json({ success: true, id: r.lastInsertRowid,
             message: 'Reservation request received. The restaurant will confirm shortly.' });
});

module.exports = router;
