const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

router.get('/', requireRole('owner','manager','chef','stockroom'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  if (!locId) {
    const rows = db.prepare(`SELECT i.*, l.name as location_name FROM inventory i JOIN locations l ON i.location_id=l.id ORDER BY l.name, i.category, i.item_name`).all();
    return res.json(rows);
  }
  const rows = db.prepare(`SELECT * FROM inventory WHERE location_id=? ORDER BY category, item_name`).all(locId);
  res.json(rows);
});

router.post('/order', requireRole('owner','manager','chef','stockroom'), (req, res) => {
  const { item_id, quantity } = req.body;
  if (!item_id || !quantity) return res.status(400).json({ error: 'item_id and quantity required' });
  const item = db.prepare(`SELECT * FROM inventory WHERE id=?`).get(item_id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  db.prepare(`INSERT INTO supply_orders (item_id, location_id, quantity, status, ordered_by) VALUES (?,?,?,'pending',?)`).run(item_id, item.location_id, quantity, req.user.id);
  res.json({ success: true });
});

router.put('/order/:id', requireRole('owner','manager'), (req, res) => {
  const { status } = req.body;
  const valid = ['pending','approved','shipped','received'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`UPDATE supply_orders SET status=? WHERE id=?`).run(status, req.params.id);
  if (status === 'received') {
    const order = db.prepare(`SELECT * FROM supply_orders WHERE id=?`).get(req.params.id);
    if (order) {
      db.prepare(`UPDATE inventory SET quantity=quantity+? WHERE id=?`).run(order.quantity, order.item_id);
      db.prepare(`INSERT INTO inventory_transactions (item_id, to_location_id, quantity, type, user_id) VALUES (?,?,?,'in',?)`).run(order.item_id, order.location_id, order.quantity, req.user.id);
    }
  }
  res.json({ success: true });
});

router.post('/transfer', requireRole('owner','manager','stockroom'), (req, res) => {
  const { item_id, from_location_id, to_location_id, quantity } = req.body;
  if (!item_id || !from_location_id || !to_location_id || !quantity) return res.status(400).json({ error: 'All fields required' });
  const src = db.prepare(`SELECT * FROM inventory WHERE id=? AND location_id=?`).get(item_id, from_location_id);
  if (!src) return res.status(404).json({ error: 'Source item not found' });
  if (src.quantity < quantity) return res.status(400).json({ error: 'Insufficient stock' });

  db.prepare(`UPDATE inventory SET quantity=quantity-? WHERE id=? AND location_id=?`).run(quantity, item_id, from_location_id);
  const dest = db.prepare(`SELECT * FROM inventory WHERE item_id=? AND location_id=?`).get(item_id, to_location_id);
  if (dest) {
    db.prepare(`UPDATE inventory SET quantity=quantity+? WHERE item_id=? AND location_id=?`).run(quantity, item_id, to_location_id);
  } else {
    db.prepare(`INSERT INTO inventory (location_id, item_name, category, unit, quantity, min_quantity) SELECT ?, item_name, category, unit, ?, min_quantity FROM inventory WHERE id=?`).run(to_location_id, quantity, item_id);
  }
  db.prepare(`INSERT INTO inventory_transactions (item_id, from_location_id, to_location_id, quantity, type, user_id) VALUES (?,?,?,?,'transfer_sent',?)`).run(item_id, from_location_id, to_location_id, quantity, req.user.id);
  res.json({ success: true });
});

router.get('/transactions', requireRole('owner','manager','stockroom'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const cond = locId ? 'WHERE (t.from_location_id=? OR t.to_location_id=?)' : '';
  const args = locId ? [locId, locId] : [];
  const rows = db.prepare(`
    SELECT t.*, i.item_name, i.unit,
           lf.name as from_location_name, lt.name as to_location_name, u.name as user_name
    FROM inventory_transactions t
    JOIN inventory i ON t.item_id=i.id
    LEFT JOIN locations lf ON t.from_location_id=lf.id
    LEFT JOIN locations lt ON t.to_location_id=lt.id
    LEFT JOIN users u ON t.user_id=u.id
    ${cond}
    ORDER BY t.created_at DESC LIMIT 100
  `).all(...args);
  res.json(rows);
});

router.get('/supply-orders', requireRole('owner','manager','stockroom'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const cond = locId ? 'WHERE so.location_id=?' : '';
  const args = locId ? [locId] : [];
  const rows = db.prepare(`
    SELECT so.*, i.item_name, i.unit, l.name as location_name, u.name as ordered_by_name
    FROM supply_orders so
    JOIN inventory i ON so.item_id=i.id
    JOIN locations l ON so.location_id=l.id
    JOIN users u ON so.ordered_by=u.id
    ${cond}
    ORDER BY so.created_at DESC
  `).all(...args);
  res.json(rows);
});

module.exports = router;
