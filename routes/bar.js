// Bar tabs: an open running check at the bar (order_type='bar', no table). The
// bartender opens a tab, adds rounds over time (via the shared order-item endpoints),
// and closes it by settling payment (shared payments flow). Drinks deplete liquor
// inventory through the normal recipe/BOM path. A tab is "open" until a payment covers
// it; "closed" once settled.
const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole, requireOnDuty } = require('../middleware/auth');
const { broadcast } = require('../lib/ws');
const { auditLog } = require('../lib/audit');

const router = express.Router();
router.use(verifyToken);

const STAFF = ['owner', 'manager', 'bartender'];

// A tab's running total = sum of its line items (pre tax/service); paid_subtotal lets
// the UI show what's already been settled (partial payments / split).
function tabsForLocation(locId, includeClosed) {
  const rows = db.prepare(`
    SELECT o.id, o.customer_name AS tab_name, o.id_checked, o.created_at, o.updated_at, u.name AS bartender_name,
           (SELECT COALESCE(SUM(oi.price*oi.quantity),0) FROM order_items oi WHERE oi.order_id=o.id) AS subtotal,
           (SELECT COALESCE(SUM(pp.subtotal),0) FROM payments pp WHERE pp.order_id=o.id AND pp.status='paid') AS paid_subtotal
    FROM orders o LEFT JOIN users u ON o.waiter_id=u.id
    WHERE o.order_type='bar' AND o.voided=0 AND o.location_id=?
    ORDER BY o.created_at DESC LIMIT 100
  `).all(locId);
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${rows.map(()=>'?').join(',')||'NULL'})`).all(...rows.map(r=>r.id));
  const byOrder = {};
  items.forEach(i => { (byOrder[i.order_id] = byOrder[i.order_id] || []).push(i); });
  return rows
    .map(r => ({ ...r, items: byOrder[r.id] || [], open: r.paid_subtotal < r.subtotal || r.subtotal === 0 }))
    .filter(r => includeClosed || r.open);
}

// List bar tabs at the caller's location (bartenders/managers: own location; owner: any).
router.get('/tabs', requireRole(...STAFF), (req, res) => {
  const locId = req.user.role === 'owner' ? (req.query.location_id || null) : req.user.location_id;
  if (!locId) return res.json([]);
  res.json(tabsForLocation(locId, req.query.include_closed === '1'));
});

// Open a new tab. Bartender must be clocked in.
router.post('/tabs', requireRole('bartender', 'manager', 'owner'), requireOnDuty, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'A tab name (guest name) is required.' });
  const idChecked = req.body.id_checked ? 1 : 0;
  const locId = req.user.role === 'owner' ? (req.body.location_id || req.user.location_id) : req.user.location_id;
  if (!locId) return res.status(400).json({ error: 'A location is required to open a tab.' });
  const r = db.prepare(`
    INSERT INTO orders (table_id, location_id, waiter_id, status, order_type, customer_name, id_checked)
    VALUES (NULL, ?, ?, 'served', 'bar', ?, ?)
  `).run(locId, req.user.id, name, idChecked);
  auditLog(req, 'bar_tab_open', 'order', r.lastInsertRowid, { name, id_checked: idChecked });
  broadcast('order_update', { type: 'bar_tab', order_id: r.lastInsertRowid, location_id: Number(locId) }, locId);
  res.json({ success: true, tab_id: r.lastInsertRowid });
});

// Update a tab's name or ID-checked flag.
router.put('/tabs/:id', requireRole('bartender', 'manager', 'owner'), requireOnDuty, (req, res) => {
  const tab = db.prepare(`SELECT * FROM orders WHERE id=? AND order_type='bar'`).get(req.params.id);
  if (!tab) return res.status(404).json({ error: 'Tab not found' });
  if (req.user.role === 'bartender' && tab.location_id !== req.user.location_id) {
    return res.status(403).json({ error: 'That tab is at another location.' });
  }
  const fields = [], vals = [];
  if (req.body.name !== undefined)       { fields.push('customer_name=?'); vals.push(String(req.body.name).trim().slice(0, 80)); }
  if (req.body.id_checked !== undefined)  { fields.push('id_checked=?');    vals.push(req.body.id_checked ? 1 : 0); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(tab.id);
  db.prepare(`UPDATE orders SET ${fields.join(',')}, updated_at=datetime('now') WHERE id=?`).run(...vals);
  auditLog(req, 'bar_tab_update', 'order', tab.id, req.body);
  broadcast('order_update', { type: 'bar_tab', order_id: tab.id, location_id: tab.location_id }, tab.location_id);
  res.json({ success: true });
});

module.exports = router;
