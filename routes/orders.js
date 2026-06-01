const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole, requireOnDuty } = require('../middleware/auth');
const { broadcast, notify } = require('../lib/ws');
const { auditLog } = require('../lib/audit');
const { depleteForOrder } = require('../lib/recipes');

const router = express.Router();
router.use(verifyToken);

router.get('/', requireRole('owner','manager','waiter','chef','employee','frontdesk','stockroom'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const status = req.query.status;
  let sql = `
    SELECT o.*, t.table_number, u.name as waiter_name,
           EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='paid') as paid
    FROM orders o
    JOIN tables t ON o.table_id=t.id
    LEFT JOIN users u ON o.waiter_id=u.id
    WHERE 1=1
  `;
  const params = [];
  if (locId) { sql += ` AND o.location_id=?`; params.push(locId); }
  if (status) { sql += ` AND o.status=?`; params.push(status); }
  sql += ` ORDER BY o.created_at DESC LIMIT 50`;
  const orders = db.prepare(sql).all(...params);

  const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${orders.map(()=>'?').join(',')||'NULL'})`).all(...orders.map(o=>o.id));
  const itemMap = {};
  items.forEach(i => { (itemMap[i.order_id] = itemMap[i.order_id]||[]).push(i); });
  res.json(orders.map(o => ({ ...o, items: itemMap[o.id] || [] })));
});

router.post('/', requireRole('waiter','manager','employee','chef','frontdesk','stockroom'), requireOnDuty, (req, res) => {
  const { table_id, items, notes } = req.body;
  if (!table_id || !items?.length) return res.status(400).json({ error: 'table_id and items required' });
  const table = db.prepare(`SELECT * FROM tables WHERE id=?`).get(table_id);
  if (!table) return res.status(404).json({ error: 'Table not found' });

  const r = db.prepare(`INSERT INTO orders (table_id, location_id, waiter_id, status, notes) VALUES (?,?,?,'pending',?)`).run(table_id, table.location_id, req.user.id, notes||null);
  const orderId = r.lastInsertRowid;
  const insertItem = db.prepare(`INSERT INTO order_items (order_id, item_name, quantity, price, notes) VALUES (?,?,?,?,?)`);
  items.forEach(i => insertItem.run(orderId, i.name, i.quantity || 1, i.price || 0, i.notes||null));
  db.prepare(`UPDATE tables SET status='ordered' WHERE id=?`).run(table_id);
  // Consume recipe ingredients from inventory and auto-86 anything now short.
  depleteForOrder(req, orderId, table.location_id);
  auditLog(req, 'order_create', 'order', orderId, { table_id, item_count: items.length });
  broadcast('order_update', { type: 'new', order_id: orderId, location_id: table.location_id }, table.location_id);
  res.json({ success: true, order_id: orderId });
});

router.put('/:id', requireRole('owner','manager','waiter','chef','employee','frontdesk','stockroom'), requireOnDuty, (req, res) => {
  const { status } = req.body;
  const valid = ['pending','preparing','ready','served'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  db.prepare(`UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  if (status === 'served' && order.table_id) {
    db.prepare(`UPDATE tables SET status='ready_clean' WHERE id=?`).run(order.table_id);
  }
  auditLog(req, 'order_status_change', 'order', req.params.id, { from: order.status, to: status });
  broadcast('order_update', { type: 'status', order_id: Number(req.params.id), status, location_id: order.location_id }, order.location_id);
  if (status === 'served' && order.table_id) {
    broadcast('table_update', { table_id: order.table_id, status: 'ready_clean', location_id: order.location_id }, order.location_id);
  }
  // Notify front-of-house when the kitchen finishes an order.
  if (status === 'ready') {
    const t = order.table_id ? db.prepare(`SELECT table_number FROM tables WHERE id=?`).get(order.table_id) : null;
    const where = t ? `Table ${t.table_number}` : 'an online order';
    notify(`Order ready — ${where}`, { locId: order.location_id, roles: ['waiter','employee','manager','frontdesk'], kind: 'order_ready' });
  }
  res.json({ success: true });
});

module.exports = router;
