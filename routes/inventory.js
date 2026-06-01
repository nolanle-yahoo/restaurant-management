const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLog } = require('../lib/audit');

const router = express.Router();
router.use(verifyToken);

// ── Waste / spoilage ───────────────────────────────────────
router.post('/waste', requireRole('owner','manager','stockroom','chef'), (req, res) => {
  const item = db.prepare(`SELECT * FROM inventory WHERE id=?`).get(req.body.item_id);
  if (!item) return res.status(404).json({ error: 'Inventory item not found' });
  if (req.user.role !== 'owner' && item.location_id !== req.user.location_id) {
    return res.status(403).json({ error: 'You can only log waste for your location.' });
  }
  const qty = Math.max(0, parseFloat(req.body.quantity) || 0);
  if (qty <= 0) return res.status(400).json({ error: 'Quantity must be greater than 0.' });
  if (qty > item.quantity) return res.status(400).json({ error: `Only ${item.quantity} ${item.unit} in stock.` });
  const reason = (req.body.reason || '').toString().slice(0, 200) || null;
  db.prepare(`UPDATE inventory SET quantity=quantity-?, last_updated=datetime('now') WHERE id=?`).run(qty, item.id);
  db.prepare(`INSERT INTO waste_log (item_id, location_id, quantity, reason, user_id) VALUES (?,?,?,?,?)`).run(item.id, item.location_id, qty, reason, req.user.id);
  db.prepare(`INSERT INTO inventory_transactions (item_id, from_location_id, quantity, type, user_id, notes) VALUES (?,?,?,'out',?,?)`).run(item.id, item.location_id, qty, req.user.id, `Waste${reason ? ': ' + reason : ''}`);
  auditLog(req, 'waste_logged', 'inventory', item.id, { item: item.item_name, quantity: qty, reason });
  res.json({ success: true });
});

router.get('/waste', requireRole('owner','manager','stockroom','chef'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const cond = locId ? 'WHERE w.location_id=?' : '';
  const args = locId ? [locId] : [];
  const rows = db.prepare(`
    SELECT w.*, i.item_name, i.unit, l.name as location_name, u.name as user_name
    FROM waste_log w
    JOIN inventory i ON w.item_id=i.id
    LEFT JOIN locations l ON w.location_id=l.id
    LEFT JOIN users u ON w.user_id=u.id
    ${cond} ORDER BY w.created_at DESC LIMIT 100
  `).all(...args);
  res.json(rows);
});

// ── Vendors (master records) ───────────────────────────────
router.get('/vendors', requireRole('owner','manager','stockroom','chef'), (req, res) => {
  res.json(db.prepare(`SELECT * FROM vendors WHERE is_active=1 ORDER BY name`).all());
});
router.post('/vendors', requireRole('owner','manager'), (req, res) => {
  const { name, contact_name, phone, email, lead_time_days, notes } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Vendor name required' });
  const r = db.prepare(`INSERT INTO vendors (name, contact_name, phone, email, lead_time_days, notes) VALUES (?,?,?,?,?,?)`)
    .run(String(name).slice(0,120), contact_name||null, phone||null, email||null, parseInt(lead_time_days)||0, notes||null);
  auditLog(req, 'vendor_create', 'vendor', r.lastInsertRowid, { name });
  res.json({ success: true, id: r.lastInsertRowid });
});
router.put('/vendors/:id', requireRole('owner','manager'), (req, res) => {
  const v = db.prepare(`SELECT * FROM vendors WHERE id=?`).get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Vendor not found' });
  const fields = [], vals = [];
  ['name','contact_name','phone','email','notes'].forEach(k => { if (req.body[k] !== undefined) { fields.push(`${k}=?`); vals.push(req.body[k] || null); } });
  if (req.body.lead_time_days !== undefined) { fields.push('lead_time_days=?'); vals.push(parseInt(req.body.lead_time_days)||0); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE vendors SET ${fields.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});
router.delete('/vendors/:id', requireRole('owner','manager'), (req, res) => {
  db.prepare(`UPDATE vendors SET is_active=0 WHERE id=?`).run(req.params.id);  // soft-delete to keep order history
  res.json({ success: true });
});

// ── Inventory levels ───────────────────────────────────────
router.get('/', requireRole('owner','manager','chef','stockroom'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  if (!locId) {
    const rows = db.prepare(`SELECT i.*, l.name as location_name FROM inventory i JOIN locations l ON i.location_id=l.id ORDER BY l.name, i.category, i.item_name`).all();
    return res.json(rows);
  }
  const rows = db.prepare(`SELECT * FROM inventory WHERE location_id=? ORDER BY category, item_name`).all(locId);
  res.json(rows);
});

// ── Warehouse view — all locations side by side ────────────
router.get('/warehouse', requireRole('owner','manager','stockroom','chef'), (req, res) => {
  const locations = db.prepare(`SELECT * FROM locations ORDER BY name`).all();
  const items = db.prepare(`
    SELECT i.item_name, i.category, i.unit,
           GROUP_CONCAT(i.location_id || ':' || i.quantity || ':' || i.min_quantity || ':' || i.id) as loc_data
    FROM inventory i GROUP BY i.item_name, i.category, i.unit ORDER BY i.category, i.item_name
  `).all();

  const rows = items.map(i => {
    const byLoc = {};
    (i.loc_data || '').split(',').forEach(seg => {
      const [lid, qty, min, id] = seg.split(':');
      byLoc[lid] = { qty: parseFloat(qty), min: parseFloat(min), id: parseInt(id) };
    });
    return { item_name: i.item_name, category: i.category, unit: i.unit, by_location: byLoc };
  });

  res.json({ locations, items: rows });
});

// ── Supply Orders ──────────────────────────────────────────
router.get('/supply-orders', requireRole('owner','manager','stockroom','chef'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const cond = locId ? 'WHERE so.location_id=?' : '';
  const args = locId ? [locId] : [];
  const rows = db.prepare(`
    SELECT so.*,
           COALESCE(so.item_name, i.item_name) as item_name,
           COALESCE(i.unit, 'units') as unit,
           COALESCE(v.name, so.vendor) as vendor_name,
           l.name as location_name, u.name as ordered_by_name
    FROM supply_orders so
    LEFT JOIN inventory i ON so.item_id=i.id
    LEFT JOIN vendors v ON so.vendor_id=v.id
    JOIN locations l ON so.location_id=l.id
    JOIN users u ON so.ordered_by=u.id
    ${cond}
    ORDER BY so.created_at DESC
  `).all(...args);
  res.json(rows);
});

router.post('/order', requireRole('owner','manager','chef','stockroom','employee'), (req, res) => {
  const { item_id, item_name: reqItemName, quantity, location_id: reqLocId,
          vendor, shipping_address, tracking_number, expected_date, notes } = req.body;
  if (!quantity) return res.status(400).json({ error: 'quantity required' });
  if (!item_id && !reqItemName) return res.status(400).json({ error: 'item_id or item_name required' });

  // Determine target location
  const forLocId = (req.user.role === 'owner' && reqLocId) ? reqLocId
                 : req.user.location_id || reqLocId;
  if (!forLocId) return res.status(400).json({ error: 'location_id required' });

  let itemId = item_id;
  let itemName = reqItemName;

  if (item_id) {
    const item = db.prepare(`SELECT * FROM inventory WHERE id=?`).get(item_id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    itemName = item.item_name;
  } else {
    // Look for or create inventory entry at target location
    let existing = db.prepare(`SELECT id FROM inventory WHERE item_name=? AND location_id=?`).get(reqItemName, forLocId);
    if (!existing) {
      const r = db.prepare(`INSERT INTO inventory (location_id, item_name, category, unit, quantity, min_quantity) VALUES (?,?,?,?,?,?)`).run(forLocId, reqItemName, 'Other', 'units', 0, 0);
      itemId = r.lastInsertRowid;
    } else {
      itemId = existing.id;
    }
  }

  db.prepare(`
    INSERT INTO supply_orders (item_id, item_name, location_id, quantity, vendor, shipping_address, tracking_number, expected_date, notes, status, ordered_by)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',?)
  `).run(itemId, itemName, forLocId, quantity, vendor||null, shipping_address||null, tracking_number||null, expected_date||null, notes||null, req.user.id);

  res.json({ success: true });
});

router.put('/order/:id', requireRole('owner','manager'), (req, res) => {
  const { status, tracking_number, shipping_address } = req.body;
  const valid = ['pending','approved','shipped','received'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const fields = ['status=?'], vals = [status];
  if (tracking_number) { fields.push('tracking_number=?'); vals.push(tracking_number); }
  if (shipping_address){ fields.push('shipping_address=?'); vals.push(shipping_address); }
  vals.push(req.params.id);
  db.prepare(`UPDATE supply_orders SET ${fields.join(',')} WHERE id=?`).run(...vals);

  if (status === 'received') {
    const order = db.prepare(`SELECT * FROM supply_orders WHERE id=?`).get(req.params.id);
    if (order && order.item_id) {
      db.prepare(`UPDATE inventory SET quantity=quantity+? WHERE id=?`).run(order.quantity, order.item_id);
      db.prepare(`INSERT INTO inventory_transactions (item_id, to_location_id, quantity, type, user_id) VALUES (?,?,?,'in',?)`).run(order.item_id, order.location_id, order.quantity, req.user.id);
    }
  }
  res.json({ success: true });
});

// ── Transfer Requests ──────────────────────────────────────
router.get('/transfer-requests', requireRole('owner','manager','stockroom','chef'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const cond = locId ? 'WHERE (tr.from_location_id=? OR tr.to_location_id=?)' : '';
  const args = locId ? [locId, locId] : [];
  const rows = db.prepare(`
    SELECT tr.*,
           lf.name as from_location_name, lt.name as to_location_name,
           u.name as requested_by_name, ua.name as approved_by_name
    FROM transfer_requests tr
    JOIN locations lf ON tr.from_location_id=lf.id
    JOIN locations lt ON tr.to_location_id=lt.id
    JOIN users u ON tr.requested_by=u.id
    LEFT JOIN users ua ON tr.approved_by=ua.id
    ${cond}
    ORDER BY tr.created_at DESC
  `).all(...args);
  res.json(rows);
});

router.post('/transfer-request', requireRole('owner','manager','stockroom','chef','employee'), (req, res) => {
  const { item_name, quantity, from_location_id, to_location_id,
          vendor, shipping_info, tracking_number, notes } = req.body;
  if (!item_name || !quantity || !from_location_id || !to_location_id) {
    return res.status(400).json({ error: 'item_name, quantity, from_location_id, to_location_id required' });
  }
  if (from_location_id == to_location_id) return res.status(400).json({ error: 'Source and destination must differ' });

  db.prepare(`
    INSERT INTO transfer_requests (item_name, quantity, from_location_id, to_location_id, requested_by, vendor, shipping_info, tracking_number, notes)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(item_name, quantity, from_location_id, to_location_id, req.user.id, vendor||null, shipping_info||null, tracking_number||null, notes||null);
  res.json({ success: true });
});

router.put('/transfer-request/:id', requireRole('owner','manager','stockroom'), (req, res) => {
  const { status, tracking_number, notes } = req.body;
  const valid = ['approved','in_transit','received','cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const tr = db.prepare(`SELECT * FROM transfer_requests WHERE id=?`).get(req.params.id);
  if (!tr) return res.status(404).json({ error: 'Transfer request not found' });

  // Pre-validate stock before touching status so they never get out of sync
  let fromItem = null;
  if (status === 'received') {
    fromItem = db.prepare(`SELECT * FROM inventory WHERE item_name=? AND location_id=?`).get(tr.item_name, tr.from_location_id);
    if (fromItem && fromItem.quantity < tr.quantity) {
      return res.status(409).json({ error: `Insufficient stock: ${fromItem.quantity} ${fromItem.unit} available, ${tr.quantity} requested` });
    }
  }

  const fields = [`status=?`, `updated_at=datetime('now')`], vals = [status];
  if (tracking_number) { fields.push('tracking_number=?'); vals.push(tracking_number); }
  if (notes)           { fields.push('notes=?');           vals.push(notes); }
  if (status === 'approved') { fields.push('approved_by=?'); vals.push(req.user.id); }
  vals.push(req.params.id);
  db.prepare(`UPDATE transfer_requests SET ${fields.join(',')} WHERE id=?`).run(...vals);

  if (status === 'received') {
    if (fromItem) {
      db.prepare(`UPDATE inventory SET quantity=quantity-? WHERE id=?`).run(tr.quantity, fromItem.id);
      db.prepare(`INSERT INTO inventory_transactions (item_id, from_location_id, to_location_id, quantity, type, user_id) VALUES (?,?,?,?,'transfer_sent',?)`).run(fromItem.id, tr.from_location_id, tr.to_location_id, tr.quantity, req.user.id);
    }
    const toItem = db.prepare(`SELECT * FROM inventory WHERE item_name=? AND location_id=?`).get(tr.item_name, tr.to_location_id);
    if (toItem) {
      db.prepare(`UPDATE inventory SET quantity=quantity+? WHERE id=?`).run(tr.quantity, toItem.id);
    } else if (fromItem) {
      db.prepare(`INSERT INTO inventory (location_id, item_name, category, unit, quantity, min_quantity) SELECT ?,item_name,category,unit,?,min_quantity FROM inventory WHERE id=?`).run(tr.to_location_id, tr.quantity, fromItem.id);
    }
  }
  res.json({ success: true });
});

// ── Direct transfer (immediate) ────────────────────────────
router.post('/transfer', requireRole('owner','manager','stockroom'), (req, res) => {
  const { item_id, from_location_id, to_location_id, quantity } = req.body;
  if (!item_id || !from_location_id || !to_location_id || !quantity) return res.status(400).json({ error: 'All fields required' });
  const src = db.prepare(`SELECT * FROM inventory WHERE id=? AND location_id=?`).get(item_id, from_location_id);
  if (!src) return res.status(404).json({ error: 'Source item not found' });
  if (src.quantity < quantity) return res.status(400).json({ error: 'Insufficient stock' });
  db.prepare(`UPDATE inventory SET quantity=quantity-? WHERE id=? AND location_id=?`).run(quantity, item_id, from_location_id);
  const dest = db.prepare(`SELECT * FROM inventory WHERE item_name=? AND location_id=?`).get(src.item_name, to_location_id);
  if (dest) {
    db.prepare(`UPDATE inventory SET quantity=quantity+? WHERE id=?`).run(quantity, dest.id);
  } else {
    db.prepare(`INSERT INTO inventory (location_id, item_name, category, unit, quantity, min_quantity) SELECT ?,item_name,category,unit,?,min_quantity FROM inventory WHERE id=?`).run(to_location_id, quantity, item_id);
  }
  db.prepare(`INSERT INTO inventory_transactions (item_id, from_location_id, to_location_id, quantity, type, user_id) VALUES (?,?,?,?,'transfer_sent',?)`).run(item_id, from_location_id, to_location_id, quantity, req.user.id);
  res.json({ success: true });
});

// ── Transaction log ────────────────────────────────────────
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

module.exports = router;
