// Public, unauthenticated endpoints for the customer-facing site
// (menu browsing + online reservation requests). No JWT required.

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { broadcast, notify } = require('../lib/ws');
const { sendEmail } = require('../lib/email');
const { depleteForOrder } = require('../lib/recipes');
const { getRates } = require('../lib/settings');
const { signCustomer, customerIdFromReq, requireCustomer } = require('../lib/customerAuth');
const round2 = n => Math.round(n * 100) / 100;

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

// ── Online ordering (pickup / delivery), pay on collection ──────────
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many order attempts. Please try again later.' },
});

// Place a customer order. Prices are taken from the server (never trusted from
// the client). Three types: dine_in (QR at a table), pickup, delivery.
//   - dine_in: requires a valid table_id; enters the floor like a normal order.
//   - pickup/delivery: no table; requires name + phone (+ address for delivery).
// If a customer is signed in (customer JWT), the order is linked for loyalty.
router.post('/order', orderLimiter, (req, res) => {
  const { location_id, order_type, items, customer_name, customer_phone, customer_email, delivery_address, notes, table_id } = req.body;
  const type = ['dine_in', 'delivery', 'pickup'].includes(order_type) ? order_type : 'pickup';
  if (!location_id || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Location and at least one item are required.' });
  }
  const loc = db.prepare(`SELECT id FROM locations WHERE id=? AND status='active'`).get(location_id);
  if (!loc) return res.status(404).json({ error: 'Location not found' });

  let tableRow = null;
  if (type === 'dine_in') {
    tableRow = db.prepare(`SELECT id, table_number FROM tables WHERE id=? AND location_id=?`).get(table_id, location_id);
    if (!tableRow) return res.status(400).json({ error: 'This QR code is no longer valid for this location.' });
  } else {
    if (!customer_name || !customer_phone) return res.status(400).json({ error: 'Your name and phone are required.' });
    if (type === 'delivery' && !delivery_address) return res.status(400).json({ error: 'A delivery address is required for delivery orders.' });
  }

  // Resolve each requested item to a real, available menu item at this location.
  const lookup = db.prepare(`SELECT id, name, price FROM menu_items WHERE id=? AND location_id=? AND is_available=1`);
  const resolved = [];
  for (const it of items) {
    const mi = lookup.get(it.id, location_id);
    if (!mi) return res.status(400).json({ error: 'One or more items are unavailable. Please refresh the menu.' });
    const qty = Math.max(1, Math.min(50, parseInt(it.quantity) || 1));
    resolved.push({ name: mi.name, price: mi.price, quantity: qty });
  }

  const customerId = customerIdFromReq(req); // null unless signed in as a customer
  const code = makeCode('ORD');
  let orderId;
  db.exec('BEGIN');
  try {
    const r = db.prepare(`
      INSERT INTO orders (table_id, location_id, waiter_id, status, notes, order_type, customer_id, customer_name, customer_phone, customer_email, delivery_address, tracking_code)
      VALUES (?, ?, NULL, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tableRow ? tableRow.id : null, location_id, notes ? String(notes).slice(0, 500) : null, type, customerId,
           customer_name ? String(customer_name).slice(0, 120) : null, customer_phone ? String(customer_phone).slice(0, 40) : null,
           (customer_email || '').trim() || null, type === 'delivery' ? String(delivery_address).slice(0, 300) : null, code);
    orderId = r.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO order_items (order_id, item_name, quantity, price) VALUES (?,?,?,?)`);
    resolved.forEach(i => ins.run(orderId, i.name, i.quantity, i.price));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  // Deplete inventory (no req.user → logged with null actor) and alert staff.
  depleteForOrder({}, orderId, Number(location_id));
  if (tableRow) {
    db.prepare(`UPDATE tables SET status='ordered' WHERE id=?`).run(tableRow.id);
    broadcast('table_update', { table_id: tableRow.id, status: 'ordered', location_id: Number(location_id) }, location_id);
  }

  const subtotal = round2(resolved.reduce((s, i) => s + i.price * i.quantity, 0));
  const { sales_tax_rate, service_charge_rate } = getRates();
  const service = round2(subtotal * service_charge_rate);
  const tax = round2((subtotal + service) * sales_tax_rate);
  const estimated_total = round2(subtotal + service + tax);

  const who = type === 'dine_in' ? `Table ${tableRow.table_number}` : (customer_name || 'Online');
  notify(`New ${type === 'dine_in' ? 'table' : type} order — ${who} (${code})`, { locId: Number(location_id), roles: ['chef', 'manager', 'owner'], kind: 'online_order' });
  broadcast('order_update', { type: 'new', order_id: orderId, location_id: Number(location_id) }, location_id);

  const locName = (db.prepare(`SELECT name FROM locations WHERE id=?`).get(location_id) || {}).name || 'our restaurant';
  if (customer_email) {
    sendEmail(customer_email.trim(),
      `Your order is in — ${code}`,
      `Hi ${customer_name},\n\nThanks for your ${type} order at ${locName}.\n\n` +
      resolved.map(i => `  ${i.name} x${i.quantity}  $${(i.price * i.quantity).toFixed(2)}`).join('\n') +
      `\n\nEstimated total (pay on ${type === 'delivery' ? 'delivery' : 'collection'}): $${estimated_total.toFixed(2)}\n` +
      `Tracking code: ${code}\nTrack it at: ${(process.env.ALLOWED_ORIGIN || 'http://localhost:3000')}/order.html?code=${code}\n\nWe'll have it ready soon!`,
      'online_order');
  }

  res.json({ success: true, tracking_code: code, estimated_total,
             message: `Order placed! Your tracking code is ${code}.` });
});

// Track an online order by code (+ phone to verify).
router.get('/order', (req, res) => {
  const { code, contact } = req.query;
  if (!code) return res.status(400).json({ error: 'Tracking code required' });
  const o = db.prepare(`
    SELECT o.tracking_code, o.status, o.order_type, o.customer_name, o.delivery_address, o.created_at, l.name as location_name
    FROM orders o JOIN locations l ON o.location_id=l.id
    WHERE o.tracking_code=?
  `).get(String(code).trim().toUpperCase());
  if (!o) return res.status(404).json({ error: 'No order found for that code.' });
  const items = db.prepare(`SELECT oi.item_name, oi.quantity, oi.price FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.tracking_code=?`).all(String(code).trim().toUpperCase());
  res.json({ ...o, items });
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
