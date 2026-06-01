const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole, requireOnDuty } = require('../middleware/auth');
const { broadcast, notify } = require('../lib/ws');
const { auditLog } = require('../lib/audit');
const { depleteForOrder } = require('../lib/recipes');
const { requireCan } = require('../lib/permissions');

const router = express.Router();
router.use(verifyToken);

router.get('/', requireRole('owner','manager','waiter','chef','employee','frontdesk','stockroom'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const status = req.query.status;
  let sql = `
    SELECT o.*, t.table_number, u.name as waiter_name,
           (EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='paid')
            AND (SELECT COALESCE(SUM(pp.subtotal),0) FROM payments pp WHERE pp.order_id=o.id AND pp.status='paid')
                >= (SELECT COALESCE(SUM(oi.price*oi.quantity),0) FROM order_items oi WHERE oi.order_id=o.id)) as paid,
           (SELECT COALESCE(SUM(pp.subtotal),0) FROM payments pp WHERE pp.order_id=o.id AND pp.status='paid') as paid_subtotal
    FROM orders o
    LEFT JOIN tables t ON o.table_id=t.id
    LEFT JOIN users u ON o.waiter_id=u.id
    WHERE o.voided=0
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
  const catFor = db.prepare(`SELECT c.name FROM menu_items mi JOIN menu_categories c ON mi.category_id=c.id WHERE mi.location_id=? AND mi.name=?`);
  const insertItem = db.prepare(`INSERT INTO order_items (order_id, item_name, quantity, price, notes, course) VALUES (?,?,?,?,?,?)`);
  items.forEach(i => {
    const cat = (catFor.get(table.location_id, i.name) || {}).name || '';
    insertItem.run(orderId, i.name, i.quantity || 1, i.price || 0, i.notes||null, courseFromCategory(cat));
  });
  db.prepare(`UPDATE tables SET status='ordered' WHERE id=?`).run(table_id);
  // Consume recipe ingredients from inventory and auto-86 anything now short.
  depleteForOrder(req, orderId, table.location_id);
  auditLog(req, 'order_create', 'order', orderId, { table_id, item_count: items.length });
  broadcast('order_update', { type: 'new', order_id: orderId, location_id: table.location_id }, table.location_id);
  res.json({ success: true, order_id: orderId });
});

// Merge a table's open orders into another table. Defined before '/:id' so the
// literal "merge" path isn't captured by the :id param route.
router.put('/merge', requireRole('owner','manager','waiter','employee','frontdesk'), requireOnDuty, (req, res) => {
  const fromTable = parseInt(req.body.from_table_id), toTable = parseInt(req.body.to_table_id);
  if (!fromTable || !toTable || fromTable === toTable) return res.status(400).json({ error: 'Pick two different tables.' });
  const src = db.prepare(`SELECT id, location_id FROM tables WHERE id=?`).get(fromTable);
  const dst = db.prepare(`SELECT id, location_id FROM tables WHERE id=?`).get(toTable);
  if (!src || !dst) return res.status(404).json({ error: 'Table not found' });
  if (src.location_id !== dst.location_id) return res.status(400).json({ error: 'Tables are at different locations.' });
  const open = db.prepare(`
    SELECT o.id FROM orders o WHERE o.table_id=? AND o.voided=0
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='paid')
  `).all(fromTable);
  if (!open.length) return res.status(400).json({ error: 'No open orders to merge from that table.' });
  const upd = db.prepare(`UPDATE orders SET table_id=?, updated_at=datetime('now') WHERE id=?`);
  open.forEach(o => upd.run(toTable, o.id));
  refreshTableStatus(fromTable, src.location_id);
  refreshTableStatus(toTable, dst.location_id);
  broadcast('order_update', { type: 'merged', location_id: src.location_id }, src.location_id);
  auditLog(req, 'table_merge', 'table', fromTable, { into: toTable, orders: open.length });
  res.json({ success: true, moved: open.length });
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

// Void an unpaid order: mark voided (with reason), restore any depleted
// inventory, free the table, and audit. Permission-gated.
router.put('/:id/void', requireOnDuty, requireCan('void'), (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.voided) return res.status(400).json({ error: 'Order is already voided' });
  const paid = db.prepare(`SELECT id FROM payments WHERE order_id=? AND status='paid'`).get(order.id);
  if (paid) return res.status(400).json({ error: 'A paid order cannot be voided — issue a refund instead.' });
  const reason = (req.body.reason || '').trim() || null;

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE orders SET voided=1, void_reason=?, updated_at=datetime('now') WHERE id=?`).run(reason, order.id);
    // Reverse inventory auto-depletion for this order.
    const outs = db.prepare(`SELECT id, item_id, quantity FROM inventory_transactions WHERE type='out' AND notes LIKE ?`).all(`Auto-deplete: order #${order.id} %`);
    const restock = db.prepare(`UPDATE inventory SET quantity=quantity+?, last_updated=datetime('now') WHERE id=?`);
    const logIn = db.prepare(`INSERT INTO inventory_transactions (item_id, to_location_id, quantity, type, user_id, notes) VALUES (?,?,?,'in',?,?)`);
    outs.forEach(t => { restock.run(t.quantity, t.item_id); logIn.run(t.item_id, order.location_id, t.quantity, req.user.id, `Void restock: order #${order.id}`); });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  if (order.table_id) {
    db.prepare(`UPDATE tables SET status='empty' WHERE id=?`).run(order.table_id);
    broadcast('table_update', { table_id: order.table_id, status: 'empty', location_id: order.location_id }, order.location_id);
  }
  broadcast('order_update', { type: 'void', order_id: order.id, location_id: order.location_id }, order.location_id);
  auditLog(req, 'order_void', 'order', order.id, { reason });
  res.json({ success: true });
});

// Free a table if it has no remaining active (non-voided, unsettled) orders.
function refreshTableStatus(tableId, locationId) {
  if (!tableId) return;
  const active = db.prepare(`
    SELECT COUNT(*) n FROM orders o WHERE o.table_id=? AND o.voided=0
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='paid')
  `).get(tableId).n;
  const status = active > 0 ? 'ordered' : 'empty';
  db.prepare(`UPDATE tables SET status=? WHERE id=?`).run(status, tableId);
  broadcast('table_update', { table_id: tableId, status, location_id: locationId }, locationId);
}

// Move an order to another table (transfer).
router.put('/:id/move', requireRole('owner','manager','waiter','employee','frontdesk'), requireOnDuty, (req, res) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.voided) return res.status(400).json({ error: 'Cannot move a voided order.' });
  const toId = parseInt(req.body.to_table_id);
  const dest = db.prepare(`SELECT id, location_id FROM tables WHERE id=?`).get(toId);
  if (!dest) return res.status(404).json({ error: 'Target table not found' });
  if (dest.location_id !== order.location_id) return res.status(400).json({ error: 'Target table is at a different location.' });
  if (toId === order.table_id) return res.status(400).json({ error: 'Order is already at that table.' });
  const fromTable = order.table_id;
  db.prepare(`UPDATE orders SET table_id=?, updated_at=datetime('now') WHERE id=?`).run(toId, order.id);
  refreshTableStatus(fromTable, order.location_id);
  refreshTableStatus(toId, order.location_id);
  broadcast('order_update', { type: 'moved', order_id: order.id, location_id: order.location_id }, order.location_id);
  auditLog(req, 'order_move', 'order', order.id, { from_table: fromTable, to_table: toId });
  res.json({ success: true });
});

module.exports = router;
