const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLog } = require('../lib/audit');

const router = express.Router();
router.use(verifyToken);

// ── Categories ────────────────────────────────────────────────
router.get('/categories', (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  if (!locId) return res.status(400).json({ error: 'location_id required' });
  res.json(db.prepare(`SELECT * FROM menu_categories WHERE location_id=? ORDER BY sort_order, name`).all(locId));
});

router.post('/categories', requireRole('owner','manager'), (req, res) => {
  const { name, sort_order, location_id: reqLocId } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const locId = req.user.role === 'owner' ? reqLocId : req.user.location_id;
  const r = db.prepare(`INSERT INTO menu_categories (location_id, name, sort_order) VALUES (?,?,?)`)
    .run(locId, name, sort_order || 0);
  auditLog(req, 'menu_category_create', 'menu_category', r.lastInsertRowid, { name });
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/categories/:id', requireRole('owner','manager'), (req, res) => {
  const { name, sort_order, is_active } = req.body;
  const fields = [], vals = [];
  if (name !== undefined)       { fields.push('name=?');       vals.push(name); }
  if (sort_order !== undefined) { fields.push('sort_order=?'); vals.push(sort_order); }
  if (is_active !== undefined)  { fields.push('is_active=?');  vals.push(is_active ? 1 : 0); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE menu_categories SET ${fields.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});

router.delete('/categories/:id', requireRole('owner','manager'), (req, res) => {
  db.prepare(`DELETE FROM menu_items WHERE category_id=?`).run(req.params.id);
  db.prepare(`DELETE FROM menu_categories WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

// ── Items ─────────────────────────────────────────────────────
router.get('/items', (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  if (!locId) return res.status(400).json({ error: 'location_id required' });
  const catId = req.query.category_id;
  let sql = `SELECT i.*, c.name as category_name FROM menu_items i JOIN menu_categories c ON i.category_id=c.id WHERE i.location_id=?`;
  const args = [locId];
  if (catId) { sql += ' AND i.category_id=?'; args.push(catId); }
  sql += ' ORDER BY c.sort_order, i.sort_order, i.name';
  res.json(db.prepare(sql).all(...args));
});

router.post('/items', requireRole('owner','manager'), (req, res) => {
  const { category_id, name, description, price, sort_order, location_id: reqLocId } = req.body;
  if (!category_id || !name || price === undefined) return res.status(400).json({ error: 'category_id, name and price required' });
  const locId = req.user.role === 'owner' ? reqLocId : req.user.location_id;
  const r = db.prepare(`INSERT INTO menu_items (category_id, location_id, name, description, price, sort_order) VALUES (?,?,?,?,?,?)`)
    .run(category_id, locId, name, description||null, price, sort_order||0);
  auditLog(req, 'menu_item_create', 'menu_item', r.lastInsertRowid, { name, price });
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/items/:id', requireRole('owner','manager','waiter','chef'), (req, res) => {
  const { name, description, price, is_available, sort_order, category_id } = req.body;
  // Waiters and chefs may only toggle availability ("86" an item) — not edit
  // names, prices, or structure.
  if (!['owner','manager'].includes(req.user.role)) {
    const onlyAvailability = is_available !== undefined &&
      [name, description, price, sort_order, category_id].every(v => v === undefined);
    if (!onlyAvailability) {
      return res.status(403).json({ error: 'Your role may only change item availability.' });
    }
  }
  const fields = [], vals = [];
  if (name !== undefined)         { fields.push('name=?');         vals.push(name); }
  if (description !== undefined)  { fields.push('description=?');  vals.push(description); }
  if (price !== undefined)        { fields.push('price=?');         vals.push(price); }
  if (is_available !== undefined) { fields.push('is_available=?'); vals.push(is_available ? 1 : 0); }
  if (sort_order !== undefined)   { fields.push('sort_order=?');   vals.push(sort_order); }
  if (category_id !== undefined)  { fields.push('category_id=?'); vals.push(category_id); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE menu_items SET ${fields.join(',')} WHERE id=?`).run(...vals);
  auditLog(req, 'menu_item_update', 'menu_item', req.params.id, { name, price, is_available });
  res.json({ success: true });
});

router.delete('/items/:id', requireRole('owner','manager'), (req, res) => {
  db.prepare(`DELETE FROM menu_items WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
