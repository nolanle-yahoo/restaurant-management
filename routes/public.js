// Public, unauthenticated endpoints for the customer-facing site
// (menu browsing + online reservation requests). No JWT required.

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { broadcast, notify } = require('../lib/ws');
const { sendEmail } = require('../lib/email');
const sms = require('../lib/sms');
const { sendSMS } = sms;
const tg = require('../lib/telegram');
const { depleteForOrder } = require('../lib/recipes');
const { getRates, getDeposit } = require('../lib/settings');
const stripeLib = require('../lib/stripe');
const { signCustomer, customerIdFromReq, requireCustomer } = require('../lib/customerAuth');
const round2 = n => Math.round(n * 100) / 100;

// Loyalty tiers by lifetime point balance, and referral bonus.
const TIERS = [{ name: 'Gold', min: 500 }, { name: 'Silver', min: 200 }, { name: 'Bronze', min: 0 }];
const tierFor = pts => (TIERS.find(t => (pts || 0) >= t.min) || TIERS[TIERS.length - 1]).name;
const REFERRAL_BONUS = 50;
const makeReferralCode = () => 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
function awardCustomerPoints(customerId, pts, reason) {
  db.prepare(`UPDATE customers SET points=points+? WHERE id=?`).run(pts, customerId);
  db.prepare(`INSERT INTO loyalty_transactions (customer_id, points, reason) VALUES (?,?,?)`).run(customerId, pts, reason);
}

// Ensure the customer has a Stripe Customer id (for saved cards), persisting it.
async function stripeCustomerFor(customerId) {
  const cust = db.prepare(`SELECT id, name, email, stripe_customer_id FROM customers WHERE id=?`).get(customerId);
  if (!cust) return null;
  const id = await stripeLib.ensureCustomer({ email: cust.email, name: cust.name, existingId: cust.stripe_customer_id });
  if (id && id !== cust.stripe_customer_id) db.prepare(`UPDATE customers SET stripe_customer_id=? WHERE id=?`).run(id, customerId);
  return id;
}

const router = express.Router();

// Short, human-friendly confirmation/receipt code (e.g. "RSV-7K3Q2H")
function makeCode(prefix) {
  return prefix + '-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

// Server-price a cart, applying menu modifiers. Each item may carry option_ids[];
// validates per-group min/max + option validity, sums price deltas into the unit
// price, and builds a readable modifier summary. Returns { error } or { resolved }.
function resolveCart(items, location_id) {
  if (!Array.isArray(items) || !items.length) return { error: 'At least one item is required.' };
  const lookup = db.prepare(`SELECT id, name, price FROM menu_items WHERE id=? AND location_id=? AND is_available=1`);
  const groupsFor = db.prepare(`SELECT id, name, min_select, max_select FROM modifier_groups WHERE menu_item_id=? ORDER BY sort_order, id`);
  const optsFor = db.prepare(`SELECT id, name, price_delta FROM modifier_options WHERE group_id=? AND is_available=1`);
  const resolved = [];
  for (const it of items) {
    const mi = lookup.get(it.id, location_id);
    if (!mi) return { error: 'One or more items are unavailable. Please refresh the menu.' };
    const qty = Math.max(1, Math.min(50, parseInt(it.quantity) || 1));
    const selected = Array.isArray(it.option_ids) ? it.option_ids.map(Number) : [];
    let unit = mi.price;
    const modParts = [];
    const validIds = new Set();
    for (const g of groupsFor.all(mi.id)) {
      const opts = optsFor.all(g.id);
      opts.forEach(o => validIds.add(o.id));
      const chosen = opts.filter(o => selected.includes(o.id));
      if (chosen.length < (g.min_select || 0)) return { error: `Please choose for "${g.name}" on ${mi.name}.` };
      if (g.max_select && chosen.length > g.max_select) return { error: `Too many choices for "${g.name}" on ${mi.name}.` };
      chosen.forEach(o => { unit += o.price_delta; });
      if (chosen.length) modParts.push(`${g.name}: ${chosen.map(o => o.name).join(', ')}`);
    }
    if (selected.some(id => !validIds.has(id))) return { error: 'Invalid option selected. Please refresh the menu.' };
    resolved.push({ name: mi.name, price: round2(unit), quantity: qty, modifiers: modParts.join(' · ') || null });
  }
  return { resolved };
}

// Validate scheduled-for time + curbside fields. Returns { error } or values.
function scheduleFields(body, type) {
  let scheduled_for = null;
  if (body.scheduled_for) {
    const d = new Date(body.scheduled_for);
    if (isNaN(d.getTime())) return { error: 'Invalid scheduled time.' };
    const now = Date.now();
    if (d.getTime() < now - 5 * 60000) return { error: 'Scheduled time must be in the future.' };
    if (d.getTime() > now + 7 * 864e5) return { error: 'Scheduled time is too far in the future.' };
    scheduled_for = String(body.scheduled_for).slice(0, 40);
  }
  const curbside = (type === 'pickup' && (body.curbside === true || body.curbside === 1 || body.curbside === 'on')) ? 1 : 0;
  const vehicle = curbside && body.vehicle ? String(body.vehicle).slice(0, 120) : null;
  return { scheduled_for, curbside, vehicle };
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
    SELECT id, category_id, name, description, price, image_url, allergens, dietary
    FROM menu_items WHERE location_id=? AND is_available=1
    ORDER BY sort_order, name
  `).all(locId);
  // Attach modifier groups (with their available options) to each item.
  const groupsFor = db.prepare(`SELECT id, name, min_select, max_select FROM modifier_groups WHERE menu_item_id=? ORDER BY sort_order, id`);
  const optsFor = db.prepare(`SELECT id, name, price_delta FROM modifier_options WHERE group_id=? AND is_available=1 ORDER BY sort_order, id`);
  items.forEach(i => {
    i.modifier_groups = groupsFor.all(i.id)
      .map(g => ({ ...g, options: optsFor.all(g.id) }))
      .filter(g => g.options.length);
  });
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
  // Deposit policy: flat amount when the party meets the minimum size.
  const dep = getDeposit();
  const depositAmount = (dep.reservation_deposit > 0 && size >= dep.reservation_deposit_min_party) ? round2(dep.reservation_deposit) : 0;
  const r = db.prepare(`
    INSERT INTO reservations (location_id, guest_name, guest_phone, guest_email, party_size,
      reservation_date, reservation_time, status, notes, confirmation_code, deposit_amount)
    VALUES (?,?,?,?,?,?,?,'pending',?,?,?)
  `).run(location_id, String(guest_name).slice(0,120), guest_phone || null, guest_email || null,
         size, reservation_date, reservation_time, notes ? String(notes).slice(0,500) : null, code, depositAmount);

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
  if (guest_phone) {
    sendSMS(guest_phone, `${locName}: reservation request for ${reservation_date} ${reservation_time}, party of ${size}. Code ${code} — we'll confirm shortly.`, 'reservation');
  }
  tg.sendTelegram(`📅 New reservation — ${guest_name}, ${reservation_date} ${reservation_time}, party of ${size} (${locName}, code ${code})`, 'reservation');

  broadcast('reservation_update', { location_id: Number(location_id) }, location_id);
  res.json({ success: true, id: r.lastInsertRowid, confirmation_code: code,
             deposit_required: depositAmount > 0, deposit_amount: depositAmount,
             message: `Reservation request received. Your confirmation code is ${code}.` });
});

// Deposit step 1: create a PaymentIntent for the reservation's deposit.
router.post('/reservations/deposit/intent', async (req, res) => {
  const code = (req.body.code || '').toString().trim().toUpperCase();
  const r = db.prepare(`SELECT * FROM reservations WHERE confirmation_code=?`).get(code);
  if (!r) return res.status(404).json({ error: 'Reservation not found.' });
  if (!(r.deposit_amount > 0)) return res.status(400).json({ error: 'No deposit is required for this reservation.' });
  if (r.deposit_status === 'paid') return res.status(409).json({ error: 'Deposit already paid.' });
  try {
    const intent = await stripeLib.createIntent(Math.round(r.deposit_amount * 100), { kind: 'reservation_deposit', code });
    res.json({ intent_id: intent.id, client_secret: intent.client_secret, simulated: !!intent.simulated,
               publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null, amount: r.deposit_amount });
  } catch (e) { console.error('deposit intent:', e.message); res.status(502).json({ error: 'Could not start payment.' }); }
});

// Deposit step 2: verify and mark paid.
router.post('/reservations/deposit/confirm', async (req, res) => {
  const code = (req.body.code || '').toString().trim().toUpperCase();
  const r = db.prepare(`SELECT * FROM reservations WHERE confirmation_code=?`).get(code);
  if (!r) return res.status(404).json({ error: 'Reservation not found.' });
  if (r.deposit_status === 'paid') return res.json({ success: true, already: true });
  const intentId = req.body.intent_id;
  if (!intentId) return res.status(400).json({ error: 'Missing payment reference.' });
  let pay;
  try { pay = await stripeLib.retrieveIntent(intentId); } catch (e) { return res.status(502).json({ error: 'Could not verify payment.' }); }
  if (pay.status !== 'succeeded') return res.status(402).json({ error: 'Payment was not completed.' });
  if (pay.amount != null && pay.amount !== Math.round(r.deposit_amount * 100)) return res.status(409).json({ error: 'Amount mismatch.' });
  db.prepare(`UPDATE reservations SET deposit_status='paid', deposit_intent=? WHERE id=?`).run(intentId, r.id);
  broadcast('reservation_update', { location_id: r.location_id }, r.location_id);
  res.json({ success: true, deposit_amount: r.deposit_amount });
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

// ── Self-service waitlist (virtual queue) ──────────────────────────
const PER_PARTY_MIN = 12; // rough per-party turnover estimate for ETA
function waitPosition(row) {
  if (row.status !== 'waiting') return { position: null, estimated_wait: null };
  // Order by id (monotonic) so parties added in the same second still rank stably.
  const ahead = db.prepare(`SELECT COUNT(*) c FROM waitlist WHERE location_id=? AND status='waiting' AND id < ?`).get(row.location_id, row.id).c;
  const position = ahead + 1;
  const estimated_wait = row.quoted_minutes != null ? row.quoted_minutes : position * PER_PARTY_MIN;
  return { position, estimated_wait };
}

// Join the queue online.
router.post('/waitlist', bookingLimiter, (req, res) => {
  const { location_id, guest_name, party_size, phone } = req.body;
  if (!location_id || !guest_name) return res.status(400).json({ error: 'Location and your name are required.' });
  const loc = db.prepare(`SELECT id FROM locations WHERE id=? AND status='active'`).get(location_id);
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  const size = Math.max(1, Math.min(50, parseInt(party_size) || 2));
  const code = makeCode('WL');
  const r = db.prepare(`INSERT INTO waitlist (location_id, guest_name, party_size, phone, public_code) VALUES (?,?,?,?,?)`)
    .run(location_id, String(guest_name).slice(0, 120), size, phone || null, code);
  broadcast('waitlist_update', { location_id: Number(location_id) }, location_id);
  const row = db.prepare(`SELECT * FROM waitlist WHERE id=?`).get(r.lastInsertRowid);
  const pos = waitPosition(row);
  const locName = (db.prepare(`SELECT name FROM locations WHERE id=?`).get(location_id) || {}).name || 'our restaurant';
  tg.sendTelegram(`⏳ New waitlist join — ${guest_name} (party of ${size}) at ${locName}, currently #${pos.position}`, 'waitlist');
  res.json({ success: true, public_code: code, position: pos.position, estimated_wait: pos.estimated_wait, party_size: size });
});

// Live status by code (guest polls this).
router.get('/waitlist', (req, res) => {
  const code = (req.query.code || '').toString().trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Code required' });
  const row = db.prepare(`SELECT w.*, l.name AS location_name FROM waitlist w JOIN locations l ON w.location_id=l.id WHERE w.public_code=?`).get(code);
  if (!row) return res.status(404).json({ error: 'No waitlist entry for that code.' });
  const pos = waitPosition(row);
  res.json({ status: row.status, ready: !!row.notified_at, party_size: row.party_size,
             guest_name: row.guest_name, location_name: row.location_name,
             position: pos.position, estimated_wait: pos.estimated_wait });
});

// Leave the queue.
router.post('/waitlist/cancel', (req, res) => {
  const code = (req.body.code || '').toString().trim().toUpperCase();
  const row = db.prepare(`SELECT * FROM waitlist WHERE public_code=?`).get(code);
  if (!row) return res.status(404).json({ error: 'No waitlist entry for that code.' });
  if (row.status === 'waiting') {
    db.prepare(`UPDATE waitlist SET status='left' WHERE id=?`).run(row.id);
    broadcast('waitlist_update', { location_id: row.location_id }, row.location_id);
  }
  res.json({ success: true });
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

  // Resolve + server-price the cart (applies menu modifiers).
  const rc = resolveCart(items, location_id);
  if (rc.error) return res.status(400).json({ error: rc.error });
  const resolved = rc.resolved;
  const sched = scheduleFields(req.body, type);
  if (sched.error) return res.status(400).json({ error: sched.error });

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
    db.prepare(`UPDATE orders SET scheduled_for=?, curbside=?, vehicle=? WHERE id=?`).run(sched.scheduled_for, sched.curbside, sched.vehicle, orderId);
    const ins = db.prepare(`INSERT INTO order_items (order_id, item_name, quantity, price, modifiers) VALUES (?,?,?,?,?)`);
    resolved.forEach(i => ins.run(orderId, i.name, i.quantity, i.price, i.modifiers || null));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  // Deplete inventory (no req.user → logged with null actor) and alert staff.
  depleteForOrder({}, orderId, Number(location_id));
  if (type === 'delivery') { try { db.prepare(`INSERT OR IGNORE INTO deliveries (order_id, location_id, status) VALUES (?,?,'pending')`).run(orderId, location_id); } catch {} }
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
  tg.sendTelegram(`🧾 New ${type} order ${code} — ${who}, est. $${estimated_total.toFixed(2)} (pay on ${type === 'delivery' ? 'delivery' : 'collection'})`, 'order');
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
  if (customer_phone && type !== 'dine_in') {
    const origin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
    sendSMS(customer_phone, `${locName}: order ${code} received (est. $${estimated_total.toFixed(2)}, pay on ${type === 'delivery' ? 'delivery' : 'collection'}). Track: ${origin}/order.html?code=${code}`, 'order');
  }

  res.json({ success: true, tracking_code: code, estimated_total,
             message: `Order placed! Your tracking code is ${code}.` });
});

// Active notification channels (for ops/verification).
router.get('/sms-config', (req, res) => {
  res.json({ provider: sms.provider, live: sms.enabled, telegram_live: tg.enabled });
});

// ── Online prepayment (Stripe) + tipping ───────────────────
// Tells the client whether real card collection is available and the publishable key.
router.get('/pay-config', (req, res) => {
  res.json({ stripe_enabled: stripeLib.enabled, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null });
});

// Validate + server-price an online (pickup/delivery) cart and return the amount
// breakdown including a clamped tip. Shared by /order/intent and /order/confirm.
function priceOnlineOrder(body) {
  const type = ['delivery', 'pickup'].includes(body.order_type) ? body.order_type : 'pickup';
  if (!body.location_id || !Array.isArray(body.items) || !body.items.length) return { error: 'Location and at least one item are required.' };
  const loc = db.prepare(`SELECT id FROM locations WHERE id=? AND status='active'`).get(body.location_id);
  if (!loc) return { error: 'Location not found' };
  if (!body.customer_name || !body.customer_phone) return { error: 'Your name and phone are required.' };
  if (type === 'delivery' && !body.delivery_address) return { error: 'A delivery address is required for delivery orders.' };
  const rc = resolveCart(body.items, body.location_id);
  if (rc.error) return { error: rc.error };
  const resolved = rc.resolved;
  const subtotal = round2(resolved.reduce((s, i) => s + i.price * i.quantity, 0));
  const { sales_tax_rate, service_charge_rate } = getRates();
  const service = round2(subtotal * service_charge_rate);
  const tax = round2((subtotal + service) * sales_tax_rate);
  const tip = round2(Math.max(0, Math.min(1000, parseFloat(body.tip) || 0)));
  const total = round2(subtotal + service + tax + tip);
  return { type, resolved, subtotal, service, tax, tip, total };
}

// Step 1: prepare payment for the priced cart (no order created yet).
//  • Saved card (signed-in): charge it off-session now and return paid_with_saved_card.
//  • New card: create a PaymentIntent; Stripe.js Payment Element handles card + wallets.
router.post('/order/intent', orderLimiter, async (req, res) => {
  const p = priceOnlineOrder(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  const cid = customerIdFromReq(req);
  const amountCents = Math.round(p.total * 100);
  const meta = { kind: 'online_order', location_id: String(req.body.location_id) };
  const breakdown = { subtotal: p.subtotal, service: p.service, tax: p.tax, tip: p.tip, total: p.total };
  try {
    // Saved card: no charge here — confirmed (charged) together with order creation.
    if (cid && req.body.card_id) {
      const card = db.prepare(`SELECT id FROM customer_cards WHERE id=? AND customer_id=?`).get(req.body.card_id, cid);
      if (!card) return res.status(404).json({ error: 'Saved card not found.' });
      return res.json({ saved_card: true, card_id: card.id, breakdown });
    }
    const stripeCust = cid ? await stripeCustomerFor(cid) : null;
    const intent = await stripeLib.createIntent(amountCents, meta, { customerId: stripeCust, savePm: !!req.body.save_card });
    res.json({
      intent_id: intent.id, client_secret: intent.client_secret, simulated: !!intent.simulated,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null, can_save: !!cid,
      breakdown,
    });
  } catch (e) {
    console.error('public intent error:', e.message);
    res.status(502).json({ error: 'Could not start payment. Please try again.' });
  }
});

// Saved payment methods for the signed-in customer.
router.get('/account/cards', requireCustomer, (req, res) => {
  res.json(db.prepare(`SELECT id, brand, last4, exp_month, exp_year FROM customer_cards WHERE customer_id=? ORDER BY created_at DESC`).all(req.customerId));
});
router.delete('/account/cards/:id', requireCustomer, async (req, res) => {
  const card = db.prepare(`SELECT * FROM customer_cards WHERE id=? AND customer_id=?`).get(req.params.id, req.customerId);
  if (!card) return res.status(404).json({ error: 'Card not found.' });
  try { await stripeLib.detachCard(card.stripe_pm_id); } catch (e) { console.error('detach failed:', e.message); }
  db.prepare(`DELETE FROM customer_cards WHERE id=?`).run(card.id);
  res.json({ success: true });
});

// Step 2: after the card is confirmed client-side, verify the intent succeeded,
// then create the (now paid) order and fire it to the kitchen.
router.post('/order/confirm', orderLimiter, async (req, res) => {
  const p = priceOnlineOrder(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  const customerId = customerIdFromReq(req);
  let intentId = req.body.intent_id;

  if (customerId && req.body.card_id) {
    // Saved-card flow: charge now, alongside order creation.
    const card = db.prepare(`SELECT * FROM customer_cards WHERE id=? AND customer_id=?`).get(req.body.card_id, customerId);
    if (!card) return res.status(404).json({ error: 'Saved card not found.' });
    const stripeCust = await stripeCustomerFor(customerId);
    let charge;
    try { charge = await stripeLib.chargeSavedCard(Math.round(p.total * 100), stripeCust, card.stripe_pm_id, { kind: 'online_order' }); }
    catch (e) { console.error('saved-card charge error:', e.message); return res.status(402).json({ error: 'Could not charge that card. Please use a new card.' }); }
    if (charge.status !== 'succeeded') return res.status(402).json({ error: 'Could not charge that card. Please use a new card.' });
    intentId = charge.id;
  } else {
    // New-card flow: the card was confirmed client-side; verify the intent.
    if (!intentId) return res.status(400).json({ error: 'Missing payment reference.' });
    let pay;
    try { pay = await stripeLib.retrieveIntent(intentId); }
    catch (e) { console.error('confirm retrieve error:', e.message); return res.status(502).json({ error: 'Could not verify payment.' }); }
    if (pay.status !== 'succeeded') return res.status(402).json({ error: 'Payment was not completed.' });
    if (pay.amount != null && pay.amount !== Math.round(p.total * 100)) {
      return res.status(409).json({ error: 'Payment amount mismatch. Please start over.' });
    }
  }
  // Guard against double-fulfilling the same payment.
  if (db.prepare(`SELECT id FROM payments WHERE stripe_payment_intent_id=?`).get(intentId)) {
    return res.status(409).json({ error: 'This payment was already processed.' });
  }

  const { location_id, customer_name, customer_phone, customer_email, delivery_address, notes } = req.body;
  const code = makeCode('ORD');
  const receiptCode = makeCode('RCT');
  let orderId;
  db.exec('BEGIN');
  try {
    const r = db.prepare(`
      INSERT INTO orders (table_id, location_id, waiter_id, status, notes, order_type, customer_id, customer_name, customer_phone, customer_email, delivery_address, tracking_code)
      VALUES (NULL, ?, NULL, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(location_id, notes ? String(notes).slice(0, 500) : null, p.type, customerId,
           String(customer_name).slice(0, 120), String(customer_phone).slice(0, 40),
           (customer_email || '').trim() || null, p.type === 'delivery' ? String(delivery_address).slice(0, 300) : null, code);
    orderId = r.lastInsertRowid;
    const sched = scheduleFields(req.body, p.type);
    if (!sched.error) db.prepare(`UPDATE orders SET scheduled_for=?, curbside=?, vehicle=? WHERE id=?`).run(sched.scheduled_for, sched.curbside, sched.vehicle, orderId);
    const ins = db.prepare(`INSERT INTO order_items (order_id, item_name, quantity, price, modifiers) VALUES (?,?,?,?,?)`);
    p.resolved.forEach(i => ins.run(orderId, i.name, i.quantity, i.price, i.modifiers || null));
    db.prepare(`
      INSERT INTO payments (order_id, location_id, waiter_id, subtotal, service_charge, tax, tip, total, method, status, stripe_payment_intent_id, receipt_code, receipt_email)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'card', 'paid', ?, ?, ?)
    `).run(orderId, location_id, p.subtotal, p.service, p.tax, p.tip, p.total, intentId, receiptCode, (customer_email || '').trim() || null);
    if (customerId && p.subtotal > 0) awardCustomerPoints(customerId, Math.floor(p.subtotal), `Online order ${code}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('confirm create error:', e.message);
    return res.status(500).json({ error: 'Payment captured but the order failed to save. Please contact the restaurant with your code.' });
  }

  // Save the card for reuse if the signed-in customer asked us to.
  if (req.body.save_card && customerId) {
    try {
      const c = await stripeLib.cardFromIntent(intentId);
      if (c) db.prepare(`INSERT OR IGNORE INTO customer_cards (customer_id, stripe_pm_id, brand, last4, exp_month, exp_year) VALUES (?,?,?,?,?,?)`)
        .run(customerId, c.stripe_pm_id, c.brand, c.last4, c.exp_month, c.exp_year);
    } catch (e) { console.error('save card failed:', e.message); }
  }

  // Now that it's paid, fire to the kitchen.
  depleteForOrder({}, orderId, Number(location_id));
  if (p.type === 'delivery') { try { db.prepare(`INSERT OR IGNORE INTO deliveries (order_id, location_id, status) VALUES (?,?,'pending')`).run(orderId, location_id); } catch {} }
  const who = customer_name || 'Online';
  notify(`New paid ${p.type} order — ${who} (${code})`, { locId: Number(location_id), roles: ['chef', 'manager', 'owner'], kind: 'online_order' });
  tg.sendTelegram(`💳 New PAID ${p.type} order ${code} — ${who}, $${p.total.toFixed(2)}`, 'order');
  broadcast('order_update', { type: 'new', order_id: orderId, location_id: Number(location_id) }, location_id);

  const locName = (db.prepare(`SELECT name FROM locations WHERE id=?`).get(location_id) || {}).name || 'our restaurant';
  if (customer_email) {
    sendEmail(customer_email.trim(),
      `Payment received — ${code}`,
      `Hi ${customer_name},\n\nThanks for your ${p.type} order at ${locName}. Your payment was received.\n\n` +
      p.resolved.map(i => `  ${i.name} x${i.quantity}  $${(i.price * i.quantity).toFixed(2)}`).join('\n') +
      `\n\nSubtotal: $${p.subtotal.toFixed(2)}\nService: $${p.service.toFixed(2)}\nTax: $${p.tax.toFixed(2)}\nTip: $${p.tip.toFixed(2)}\nTotal paid: $${p.total.toFixed(2)}\n\n` +
      `Tracking code: ${code}\nReceipt: ${(process.env.ALLOWED_ORIGIN || 'http://localhost:3000')}/receipt.html?code=${receiptCode}\n\nWe'll have it ready soon!`,
      'online_order');
  }
  if (customer_phone) {
    const origin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
    sendSMS(customer_phone, `${locName}: payment received for order ${code} ($${p.total.toFixed(2)}). Track: ${origin}/order.html?code=${code}`, 'order');
  }

  res.json({ success: true, paid: true, tracking_code: code, receipt_code: receiptCode,
             breakdown: { subtotal: p.subtotal, service: p.service, tax: p.tax, tip: p.tip, total: p.total } });
});

// Track an online order by code (+ phone to verify).
router.get('/order', (req, res) => {
  const { code, contact } = req.query;
  if (!code) return res.status(400).json({ error: 'Tracking code required' });
  const o = db.prepare(`
    SELECT o.tracking_code, o.status, o.order_type, o.customer_name, o.delivery_address, o.created_at, l.name as location_name,
           o.scheduled_for, o.curbside, o.vehicle, o.arrived_at
    FROM orders o JOIN locations l ON o.location_id=l.id
    WHERE o.tracking_code=?
  `).get(String(code).trim().toUpperCase());
  if (!o) return res.status(404).json({ error: 'No order found for that code.' });
  const items = db.prepare(`SELECT oi.item_name, oi.quantity, oi.price, oi.modifiers FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.tracking_code=?`).all(String(code).trim().toUpperCase());
  // Delivery tracking: include driver first name, status, ETA, and last location.
  let delivery = null;
  if (o.order_type === 'delivery') {
    const d = db.prepare(`
      SELECT d.status, d.eta_minutes, d.driver_lat, d.driver_lng, d.location_updated_at,
             d.assigned_at, d.picked_up_at, d.delivered_at, u.name AS driver_name
      FROM deliveries d JOIN orders o2 ON d.order_id=o2.id LEFT JOIN users u ON d.driver_id=u.id
      WHERE o2.tracking_code=?
    `).get(String(code).trim().toUpperCase());
    if (d) delivery = {
      status: d.status, eta_minutes: d.eta_minutes,
      driver_name: d.driver_name ? d.driver_name.split(' ')[0] : null,
      driver_lat: d.driver_lat, driver_lng: d.driver_lng, location_updated_at: d.location_updated_at,
      assigned_at: d.assigned_at, picked_up_at: d.picked_up_at, delivered_at: d.delivered_at,
    };
  }
  res.json({ ...o, items, delivery });
});

// Curbside "I'm here" — guest signals arrival; staff are notified.
router.post('/order/arrived', (req, res) => {
  const code = (req.body.code || '').toString().trim().toUpperCase();
  const o = db.prepare(`SELECT * FROM orders WHERE tracking_code=?`).get(code);
  if (!o) return res.status(404).json({ error: 'No order found for that code.' });
  if (!o.curbside) return res.status(400).json({ error: 'This is not a curbside order.' });
  if (o.arrived_at) return res.json({ success: true, already: true });
  db.prepare(`UPDATE orders SET arrived_at=datetime('now') WHERE id=?`).run(o.id);
  const locName = (db.prepare(`SELECT name FROM locations WHERE id=?`).get(o.location_id) || {}).name || 'the restaurant';
  notify(`🚗 Curbside arrived — ${o.customer_name || 'guest'} (${o.tracking_code})${o.vehicle ? `, ${o.vehicle}` : ''}`, { locId: o.location_id, roles: ['chef', 'manager', 'frontdesk', 'owner'], kind: 'order_ready' });
  tg.sendTelegram(`🚗 Curbside arrival — ${o.customer_name || 'guest'} for order ${o.tracking_code}${o.vehicle ? ` (${o.vehicle})` : ''} at ${locName}`, 'order');
  broadcast('order_update', { type: 'arrived', order_id: o.id, location_id: o.location_id }, o.location_id);
  res.json({ success: true });
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
  const items = db.prepare(`SELECT item_name, quantity, price, modifiers FROM order_items WHERE order_id=?`).all(p.order_id);
  res.json({ ...p, items });
});

// ── Customer accounts & loyalty ─────────────────────────────────────
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

router.post('/account/register', accountLimiter, (req, res) => {
  const { name, email, password, phone, marketing_opt_in } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const em = String(email).trim().toLowerCase();
  if (db.prepare(`SELECT id FROM customers WHERE email=?`).get(em)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }
  // Optional referral: credit the referrer and the new member.
  let referrer = null;
  if (req.body.referral_code) {
    referrer = db.prepare(`SELECT id FROM customers WHERE referral_code=?`).get(String(req.body.referral_code).trim().toUpperCase());
  }
  const unsub = crypto.randomBytes(16).toString('hex');
  let myCode; // unique referral code
  do { myCode = makeReferralCode(); } while (db.prepare(`SELECT 1 FROM customers WHERE referral_code=?`).get(myCode));

  const welcome = referrer ? REFERRAL_BONUS : 0;
  const r = db.prepare(`INSERT INTO customers (name, email, phone, password_hash, marketing_opt_in, unsubscribe_token, referral_code, referred_by, points) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(String(name).slice(0, 120), em, phone ? String(phone).slice(0, 40) : null, bcrypt.hashSync(String(password), 10), marketing_opt_in ? 1 : 0, unsub, myCode, referrer ? referrer.id : null, welcome);
  const id = r.lastInsertRowid;
  if (referrer) {
    db.prepare(`INSERT INTO loyalty_transactions (customer_id, points, reason) VALUES (?,?,?)`).run(id, welcome, 'Referral welcome bonus');
    awardCustomerPoints(referrer.id, REFERRAL_BONUS, 'Referred a friend');
  }
  const c = { id, name, email: em };
  res.json({ token: signCustomer(c), customer: { ...c, points: welcome, marketing_opt_in: marketing_opt_in ? 1 : 0, tier: tierFor(welcome), referral_code: myCode } });
});

router.post('/account/login', accountLimiter, (req, res) => {
  const { email, password } = req.body;
  const c = db.prepare(`SELECT * FROM customers WHERE email=?`).get(String(email || '').trim().toLowerCase());
  if (!c || !bcrypt.compareSync(String(password || ''), c.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  res.json({ token: signCustomer(c), customer: { id: c.id, name: c.name, email: c.email, points: c.points, marketing_opt_in: c.marketing_opt_in, tier: tierFor(c.points), referral_code: c.referral_code } });
});

router.get('/account/me', requireCustomer, (req, res) => {
  const c = db.prepare(`SELECT id, name, email, phone, points, marketing_opt_in, referral_code FROM customers WHERE id=?`).get(req.customerId);
  if (!c) return res.status(404).json({ error: 'Account not found' });
  const nextTier = TIERS.slice().reverse().find(t => t.min > c.points);
  res.json({ ...c, tier: tierFor(c.points), next_tier: nextTier ? { name: nextTier.name, points_needed: nextTier.min - c.points } : null });
});

router.put('/account/preferences', requireCustomer, (req, res) => {
  const optIn = req.body.marketing_opt_in ? 1 : 0;
  db.prepare(`UPDATE customers SET marketing_opt_in=? WHERE id=?`).run(optIn, req.customerId);
  res.json({ success: true, marketing_opt_in: optIn });
});

router.get('/account/orders', requireCustomer, (req, res) => {
  const orders = db.prepare(`
    SELECT id, tracking_code, order_type, status, created_at,
           (SELECT COALESCE(SUM(price*quantity),0) FROM order_items WHERE order_id=orders.id) AS subtotal
    FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 50
  `).all(req.customerId);
  const itemsBy = {};
  orders.forEach(o => { itemsBy[o.id] = db.prepare(`SELECT item_name, quantity, price, modifiers FROM order_items WHERE order_id=?`).all(o.id); });
  res.json(orders.map(o => ({ ...o, items: itemsBy[o.id] || [] })));
});

router.get('/account/loyalty', requireCustomer, (req, res) => {
  const c = db.prepare(`SELECT points, referral_code FROM customers WHERE id=?`).get(req.customerId);
  const ledger = db.prepare(`SELECT points, reason, created_at FROM loyalty_transactions WHERE customer_id=? ORDER BY created_at DESC LIMIT 50`).all(req.customerId);
  const points = c ? c.points : 0;
  res.json({ points, tier: tierFor(points), referral_code: c ? c.referral_code : null, ledger });
});

// Post-visit feedback from the receipt page (rating 1–5 + optional comment).
router.post('/feedback', orderLimiter, (req, res) => {
  const code = String(req.body.receipt_code || '').trim().toUpperCase();
  const rating = parseInt(req.body.rating);
  const comment = (req.body.comment || '').toString().slice(0, 1000) || null;
  if (!code || !(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'A receipt code and a rating (1–5) are required.' });
  const p = db.prepare(`SELECT order_id, location_id FROM payments WHERE receipt_code=?`).get(code);
  if (!p) return res.status(404).json({ error: 'We could not find that receipt.' });
  if (db.prepare(`SELECT id FROM feedback WHERE receipt_code=?`).get(code)) {
    return res.status(409).json({ error: 'Feedback has already been submitted for this receipt. Thank you!' });
  }
  db.prepare(`INSERT INTO feedback (receipt_code, order_id, location_id, rating, comment) VALUES (?,?,?,?,?)`)
    .run(code, p.order_id, p.location_id, rating, comment);
  res.json({ success: true, message: 'Thank you for your feedback!' });
});

// Public unsubscribe from marketing email (one-click token from email footer).
router.post('/unsubscribe', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing unsubscribe token.' });
  const c = db.prepare(`SELECT id FROM customers WHERE unsubscribe_token=?`).get(String(token));
  if (!c) return res.status(404).json({ error: 'This unsubscribe link is invalid.' });
  db.prepare(`UPDATE customers SET marketing_opt_in=0 WHERE id=?`).run(c.id);
  res.json({ success: true, message: 'You have been unsubscribed from marketing emails.' });
});

module.exports = router;
