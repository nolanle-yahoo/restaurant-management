const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const { verifyToken, requireRole, requireOnDuty } = require('../middleware/auth');
const stripeLib = require('../lib/stripe');
const { broadcast } = require('../lib/ws');
const { auditLog } = require('../lib/audit');
const { sendEmail } = require('../lib/email');
const { getRates } = require('../lib/settings');

const router = express.Router();
router.use(verifyToken);

const STAFF = ['owner','manager','waiter','employee','frontdesk','chef','stockroom'];
const round2 = n => Math.round(n * 100) / 100;
const makeReceiptCode = () => 'RCT-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);

// Emails a receipt for a paid payment if a receipt_email is on file.
function emailReceipt(paymentId) {
  const p = db.prepare(`SELECT * FROM payments WHERE id=?`).get(paymentId);
  if (!p || !p.receipt_email) return;
  const loc = (db.prepare(`SELECT l.name FROM payments p JOIN locations l ON p.location_id=l.id WHERE p.id=?`).get(paymentId) || {}).name || 'our restaurant';
  const items = db.prepare(`SELECT oi.item_name, oi.quantity, oi.price FROM order_items oi WHERE oi.order_id=?`).all(p.order_id);
  const lines = items.map(i => `  ${i.item_name} x${i.quantity}  $${(i.price*i.quantity).toFixed(2)}`).join('\n');
  const base = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
  sendEmail(p.receipt_email,
    `Your receipt from ${loc} — ${p.receipt_code}`,
    `Thank you for dining with us at ${loc}!\n\n${lines}\n\n` +
    `Subtotal: $${p.subtotal.toFixed(2)}\nTax: $${p.tax.toFixed(2)}\nTip: $${p.tip.toFixed(2)}\nTotal: $${p.total.toFixed(2)}\n` +
    `Paid by: ${p.method}\n\nReceipt code: ${p.receipt_code}\nView online: ${base}/receipt.html?code=${p.receipt_code}\n`,
    'receipt');
}

function computeBill(orderId) {
  const order = db.prepare(`SELECT o.*, t.table_number FROM orders o JOIN tables t ON o.table_id=t.id WHERE o.id=?`).get(orderId);
  if (!order) return null;
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id=?`).all(orderId);
  const { sales_tax_rate, service_charge_rate } = getRates();
  const subtotal = round2(items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0));
  const service_charge = round2(subtotal * service_charge_rate);
  const tax = round2((subtotal + service_charge) * sales_tax_rate);
  return { order, items, subtotal, service_charge, tax, tax_rate: sales_tax_rate, service_rate: service_charge_rate };
}

// Frontend asks which payment flow to use
router.get('/config', (req, res) => {
  const { sales_tax_rate, service_charge_rate } = getRates();
  res.json({ stripe_enabled: stripeLib.enabled, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
             sales_tax_rate, service_charge_rate });
});

// Itemized bill + any existing payment for an order
router.get('/order/:orderId', requireRole(...STAFF), (req, res) => {
  const bill = computeBill(req.params.orderId);
  if (!bill) return res.status(404).json({ error: 'Order not found' });
  const payment = db.prepare(`SELECT * FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1`).get(req.params.orderId);
  res.json({ ...bill, payment: payment || null });
});

// List payments for a location (sales history)
router.get('/', requireRole('owner','manager'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const cond = locId ? 'WHERE p.location_id=?' : '';
  const args = locId ? [locId] : [];
  const rows = db.prepare(`
    SELECT p.*, o.table_id, t.table_number, u.name as waiter_name, l.name as location_name
    FROM payments p
    JOIN orders o ON p.order_id=o.id
    LEFT JOIN tables t ON o.table_id=t.id
    LEFT JOIN users u ON p.waiter_id=u.id
    LEFT JOIN locations l ON p.location_id=l.id
    ${cond}
    ORDER BY p.created_at DESC LIMIT 200
  `).all(...args);
  res.json(rows);
});

function settleOrder(req, orderId) {
  const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(orderId);
  if (!order) return;
  db.prepare(`UPDATE orders SET status='served', updated_at=datetime('now') WHERE id=?`).run(orderId);
  db.prepare(`UPDATE tables SET status='ready_clean' WHERE id=?`).run(order.table_id);
  broadcast('order_update', { type: 'paid', order_id: Number(orderId), location_id: order.location_id }, order.location_id);
  broadcast('table_update', { table_id: order.table_id, status: 'ready_clean', location_id: order.location_id }, order.location_id);
}

// Direct payment (cash / mobile / simulated card). Records as paid immediately.
router.post('/', requireRole(...STAFF), requireOnDuty, (req, res) => {
  const { order_id, tip, method, email } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });
  const m = ['card','cash','mobile'].includes(method) ? method : 'cash';
  const bill = computeBill(order_id);
  if (!bill) return res.status(404).json({ error: 'Order not found' });

  const existing = db.prepare(`SELECT id FROM payments WHERE order_id=? AND status='paid'`).get(order_id);
  if (existing) return res.status(409).json({ error: 'This order is already paid' });

  const tipAmt = round2(Math.max(0, parseFloat(tip) || 0));
  const total = round2(bill.subtotal + bill.service_charge + bill.tax + tipAmt);
  const receipt = makeReceiptCode();

  const r = db.prepare(`
    INSERT INTO payments (order_id, location_id, waiter_id, subtotal, service_charge, tax, tip, total, method, status, processed_by, receipt_code, receipt_email)
    VALUES (?,?,?,?,?,?,?,?,?,'paid',?,?,?)
  `).run(order_id, bill.order.location_id, bill.order.waiter_id, bill.subtotal, bill.service_charge, bill.tax, tipAmt, total, m, req.user.id, receipt, (email||'').trim() || null);

  settleOrder(req, order_id);
  emailReceipt(r.lastInsertRowid);
  auditLog(req, 'payment_recorded', 'payment', r.lastInsertRowid, { method: m, total, tip: tipAmt });
  res.json({ success: true, payment_id: r.lastInsertRowid, total, receipt_code: receipt });
});

// Create a Stripe PaymentIntent for card payment (real gateway flow)
router.post('/intent', requireRole(...STAFF), requireOnDuty, async (req, res) => {
  const { order_id, tip, email } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });
  const bill = computeBill(order_id);
  if (!bill) return res.status(404).json({ error: 'Order not found' });

  const existing = db.prepare(`SELECT id FROM payments WHERE order_id=? AND status='paid'`).get(order_id);
  if (existing) return res.status(409).json({ error: 'This order is already paid' });

  const tipAmt = round2(Math.max(0, parseFloat(tip) || 0));
  const total = round2(bill.subtotal + bill.service_charge + bill.tax + tipAmt);

  try {
    const intent = await stripeLib.createIntent(Math.round(total * 100), { order_id: String(order_id), location_id: String(bill.order.location_id) });
    const r = db.prepare(`
      INSERT INTO payments (order_id, location_id, waiter_id, subtotal, service_charge, tax, tip, total, method, status, stripe_payment_intent_id, processed_by, receipt_code, receipt_email)
      VALUES (?,?,?,?,?,?,?,?,'card','pending',?,?,?,?)
    `).run(order_id, bill.order.location_id, bill.order.waiter_id, bill.subtotal, bill.service_charge, bill.tax, tipAmt, total, intent.id, req.user.id, makeReceiptCode(), (email||'').trim() || null);
    res.json({ payment_id: r.lastInsertRowid, client_secret: intent.client_secret, simulated: !!intent.simulated, total,
               publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null });
  } catch (e) {
    console.error('Stripe intent error:', e.message);
    res.status(502).json({ error: 'Payment processor error' });
  }
});

// Confirm a card payment after the client completes the Stripe flow
router.post('/:id/confirm', requireRole(...STAFF), requireOnDuty, async (req, res) => {
  const payment = db.prepare(`SELECT * FROM payments WHERE id=?`).get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status === 'paid') return res.json({ success: true, already: true });

  try {
    const status = await stripeLib.retrieveStatus(payment.stripe_payment_intent_id);
    if (status !== 'succeeded') {
      db.prepare(`UPDATE payments SET status='failed', updated_at=datetime('now') WHERE id=?`).run(payment.id);
      return res.status(402).json({ error: 'Payment not completed (' + status + ')' });
    }
    db.prepare(`UPDATE payments SET status='paid', updated_at=datetime('now') WHERE id=?`).run(payment.id);
    settleOrder(req, payment.order_id);
    emailReceipt(payment.id);
    auditLog(req, 'payment_recorded', 'payment', payment.id, { method: 'card', total: payment.total, tip: payment.tip });
    res.json({ success: true, total: payment.total, receipt_code: payment.receipt_code });
  } catch (e) {
    console.error('Stripe confirm error:', e.message);
    res.status(502).json({ error: 'Payment processor error' });
  }
});

// Refund a paid payment
router.post('/:id/refund', requireRole('owner','manager'), async (req, res) => {
  const payment = db.prepare(`SELECT * FROM payments WHERE id=?`).get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status !== 'paid') return res.status(400).json({ error: 'Only paid payments can be refunded' });
  try {
    await stripeLib.refund(payment.stripe_payment_intent_id);
    db.prepare(`UPDATE payments SET status='refunded', updated_at=datetime('now') WHERE id=?`).run(payment.id);
    auditLog(req, 'payment_refunded', 'payment', payment.id, { total: payment.total });
    res.json({ success: true });
  } catch (e) {
    console.error('Stripe refund error:', e.message);
    res.status(502).json({ error: 'Refund failed' });
  }
});

module.exports = router;
