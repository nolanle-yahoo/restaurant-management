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
  const code = makeCode('RSV');
  const r = db.prepare(`
    INSERT INTO reservations (location_id, guest_name, guest_phone, guest_email, party_size,
      reservation_date, reservation_time, status, notes, confirmation_code)
    VALUES (?,?,?,?,?,?,?,'pending',?,?)
  `).run(location_id, String(guest_name).slice(0,120), guest_phone || null, guest_email || null,
         size, reservation_date, reservation_time, notes ? String(notes).slice(0,500) : null, code);

  const locName = (db.prepare(`SELECT name FROM locations WHERE id=?`).get(location_id) || {}).name || 'our restaurant';
  if (guest_email) {
    sendEmail(guest_email.trim(),
      `Reservation request received — ${code}`,
      `Hi ${guest_name},\n\nWe've received your reservation request at ${locName}:\n` +
      `  Date: ${reservation_date} at ${reservation_time}\n  Party size: ${size}\n  Confirmation code: ${code}\n\n` +
      `Status: PENDING — the restaurant will confirm shortly.\n` +
      `Check status or cancel anytime at:\n${(process.env.ALLOWED_ORIGIN||'http://localhost:3000')}/reserve-lookup.html\n\nThank you!`,
      'reservation_request');
  }

  broadcast('reservation_update', { location_id: Number(location_id) }, location_id);
  res.json({ success: true, id: r.lastInsertRowid, confirmation_code: code,
             message: `Reservation request received. Your confirmation code is ${code}.` });
});

// Public reservation lookup by code (+ email or phone to verify identity)
router.get('/reservations/lookup', (req, res) => {
  const { code, contact } = req.query;
  if (!code || !contact) return res.status(400).json({ error: 'Confirmation code and email/phone required' });
  const r = db.prepare(`
    SELECT res.confirmation_code, res.guest_name, res.party_size, res.reservation_date,
           res.reservation_time, res.status, res.notes, l.name as location_name
    FROM reservations res JOIN locations l ON res.location_id=l.id
    WHERE res.confirmation_code=? AND (res.guest_email=? OR res.guest_phone=?)
  `).get(code.trim().toUpperCase(), contact.trim(), contact.trim());
  if (!r) return res.status(404).json({ error: 'No reservation found for that code and contact.' });
  res.json(r);
});

// Public cancel by code + matching contact
router.post('/reservations/cancel', (req, res) => {
  const { code, contact } = req.body;
  if (!code || !contact) return res.status(400).json({ error: 'Confirmation code and email/phone required' });
  const r = db.prepare(`
    SELECT * FROM reservations WHERE confirmation_code=? AND (guest_email=? OR guest_phone=?)
  `).get(code.trim().toUpperCase(), contact.trim(), contact.trim());
  if (!r) return res.status(404).json({ error: 'No reservation found for that code and contact.' });
  if (['completed','cancelled','no_show'].includes(r.status)) {
    return res.status(400).json({ error: `This reservation is already ${r.status} and cannot be cancelled.` });
  }
  db.prepare(`UPDATE reservations SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(r.id);
  broadcast('reservation_update', { location_id: r.location_id }, r.location_id);
  res.json({ success: true, message: 'Your reservation has been cancelled.' });
});

// Public receipt view by code
router.get('/receipt', (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Receipt code required' });
  const p = db.prepare(`
    SELECT p.receipt_code, p.subtotal, p.tax, p.tip, p.total, p.method, p.status, p.created_at,
           o.id as order_id, t.table_number, l.name as location_name
    FROM payments p
    JOIN orders o ON p.order_id=o.id
    LEFT JOIN tables t ON o.table_id=t.id
    LEFT JOIN locations l ON p.location_id=l.id
    WHERE p.receipt_code=?
  `).get(code.trim().toUpperCase());
  if (!p) return res.status(404).json({ error: 'Receipt not found' });
  const items = db.prepare(`SELECT item_name, quantity, price FROM order_items WHERE order_id=?`).all(p.order_id);
  res.json({ ...p, items });
});

module.exports = router;
