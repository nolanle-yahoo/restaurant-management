const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

router.get('/', requireRole('owner','manager','waiter','chef'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const status = req.query.status;
  let sql = `
    SELECT o.*, t.table_number, u.name as waiter_name
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

router.post('/', requireRole('waiter','manager'), (req, res) => {
  const { table_id, items } = req.body;
  if (!table_id || !items?.length) return res.status(400).json({ error: 'table_id and items required' });
  const table = db.prepare(`SELECT * FROM tables WHERE id=?`).get(table_id);
  if (!table) return res.status(404).json({ error: 'Table not found' });

  const r = db.prepare(`INSERT INTO orders (table_id, location_id, waiter_id, status) VALUES (?,?,?,'pending')`).run(table_id, table.location_id, req.user.id);
  const orderId = r.lastInsertRowid;
  const insertItem = db.prepare(`INSERT INTO order_items (order_id, item_name, quantity, price) VALUES (?,?,?,?)`);
  items.forEach(i => insertItem.run(orderId, i.name, i.quantity || 1, i.price || 0));
  db.prepare(`UPDATE tables SET status='ordered' WHERE id=?`).run(table_id);
  res.json({ success: true, order_id: orderId });
});

router.put('/:id', requireRole('owner','manager','waiter','chef'), (req, res) => {
  const { status } = req.body;
  const valid = ['pending','preparing','ready','served'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  if (status === 'served') {
    const order = db.prepare(`SELECT table_id FROM orders WHERE id=?`).get(req.params.id);
    if (order) db.prepare(`UPDATE tables SET status='ready_clean' WHERE id=?`).run(order.table_id);
  }
  res.json({ success: true });
});

module.exports = router;
