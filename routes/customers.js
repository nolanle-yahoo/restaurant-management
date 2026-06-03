// Guest CRM — staff view over registered customers: spend/visit aggregates,
// editable notes/tags/VIP flag, and per-guest order + reservation history.
const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLog } = require('../lib/audit');

const router = express.Router();
router.use(verifyToken);
const STAFF = ['owner', 'manager', 'frontdesk'];

const tierFor = pts => (pts >= 500 ? 'Gold' : pts >= 200 ? 'Silver' : 'Bronze');

// List / search customers with spend + visit aggregates.
router.get('/', requireRole(...STAFF), (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const cond = q ? `WHERE c.name LIKE ? OR c.email LIKE ?` : '';
  const args = q ? [`%${q}%`, `%${q}%`] : [];
  const rows = db.prepare(`
    SELECT c.id, c.name, c.email, c.phone, c.points, c.vip, c.tags,
           (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id) AS orders,
           (SELECT COALESCE(SUM(p.total),0) FROM payments p JOIN orders o ON p.order_id=o.id
             WHERE o.customer_id=c.id AND p.status='paid') AS spend
    FROM customers c
    ${cond}
    ORDER BY c.vip DESC, spend DESC, c.name
    LIMIT 100
  `).all(...args);
  res.json(rows.map(r => ({ ...r, tier: tierFor(r.points || 0) })));
});

// Full profile + history.
router.get('/:id', requireRole(...STAFF), (req, res) => {
  const c = db.prepare(`SELECT id, name, email, phone, points, vip, tags, notes, marketing_opt_in, referral_code, created_at FROM customers WHERE id=?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  c.tier = tierFor(c.points || 0);
  const orders = db.prepare(`
    SELECT o.id, o.tracking_code, o.order_type, o.status, o.created_at, l.name AS location_name,
           (SELECT COALESCE(SUM(p.total),0) FROM payments p WHERE p.order_id=o.id AND p.status='paid') AS total,
           (SELECT COALESCE(SUM(oi.price*oi.quantity),0) FROM order_items oi WHERE oi.order_id=o.id) AS subtotal
    FROM orders o LEFT JOIN locations l ON o.location_id=l.id
    WHERE o.customer_id=? ORDER BY o.created_at DESC LIMIT 15
  `).all(c.id);
  // Reservations are matched by email (reservations aren't account-linked).
  const reservations = c.email ? db.prepare(`
    SELECT r.confirmation_code, r.reservation_date, r.reservation_time, r.party_size, r.status, l.name AS location_name
    FROM reservations r LEFT JOIN locations l ON r.location_id=l.id
    WHERE r.guest_email=? ORDER BY r.reservation_date DESC LIMIT 15
  `).all(c.email) : [];
  const spend = orders.reduce((s, o) => s + (o.total || 0), 0);
  res.json({ ...c, orders, reservations, total_spend: Math.round(spend * 100) / 100, visit_count: orders.length });
});

// Update CRM fields (notes / tags / VIP).
router.put('/:id', requireRole(...STAFF), (req, res) => {
  const c = db.prepare(`SELECT id FROM customers WHERE id=?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  const fields = [], vals = [];
  if (req.body.notes !== undefined) { fields.push('notes=?'); vals.push(String(req.body.notes).slice(0, 1000) || null); }
  if (req.body.tags !== undefined)  { fields.push('tags=?');  vals.push(String(req.body.tags).slice(0, 300) || null); }
  if (req.body.vip !== undefined)   { fields.push('vip=?');   vals.push(req.body.vip ? 1 : 0); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE customers SET ${fields.join(',')} WHERE id=?`).run(...vals);
  auditLog(req, 'customer_crm_update', 'customer', Number(req.params.id), { vip: req.body.vip });
  res.json({ success: true });
});

module.exports = router;
