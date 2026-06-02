const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole, isOnDuty } = require('../middleware/auth');
const { broadcast, notify } = require('../lib/ws');

const router = express.Router();
router.use(verifyToken);

const VALID_STATUSES = ['empty','occupied','waiting_order','ordered','waiting_food','need_help','waiting_payment','special_request','ready_clean','cleaning'];

// GET /tables?location_id=
router.get('/', requireRole('owner','manager','frontdesk','waiter','chef','employee','stockroom'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  if (!locId) return res.status(400).json({ error: 'location_id required' });
  const rows = db.prepare(`
    SELECT t.*, a.name as area_name, a.color as area_color,
           u.name as waiter_name, u.id as waiter_id,
           au.name as assigned_to_name
    FROM tables t
    LEFT JOIN areas a ON t.area_id = a.id
    LEFT JOIN waiter_assignments wa ON wa.area_id = t.area_id
    LEFT JOIN users u ON wa.user_id = u.id
    LEFT JOIN users au ON t.assigned_to = au.id
    WHERE t.location_id = ?
    ORDER BY a.sort_order, t.table_number
  `).all(locId);
  res.json(rows);
});

// GET /tables/by-area?location_id=
router.get('/by-area', requireRole('owner','manager','frontdesk','waiter','chef','employee','stockroom'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  if (!locId) return res.status(400).json({ error: 'location_id required' });
  const areas = db.prepare(`SELECT * FROM areas WHERE location_id = ? ORDER BY sort_order, name`).all(locId);
  const tables = db.prepare(`SELECT * FROM tables WHERE location_id = ? ORDER BY table_number`).all(locId);
  const assignments = db.prepare(`
    SELECT wa.id as assignment_id, wa.area_id, u.id, u.name, u.role
    FROM waiter_assignments wa JOIN users u ON wa.user_id = u.id
    WHERE wa.area_id IN (SELECT id FROM areas WHERE location_id = ?)
  `).all(locId);
  const result = areas.map(a => ({
    ...a,
    tables:  tables.filter(t => t.area_id === a.id),
    waiters: assignments.filter(w => w.area_id === a.id),
  }));
  const unassigned = tables.filter(t => !t.area_id);
  if (unassigned.length) result.push({ id: null, name: 'Unassigned', color: '#999', tables: unassigned, waiters: [] });
  res.json(result);
});

// POST /tables — create table
router.post('/', requireRole('owner','manager'), (req, res) => {
  const { location_id, table_number, capacity, area_id } = req.body;
  const locId = req.user.role === 'owner' ? location_id : req.user.location_id;
  if (!locId || !table_number) return res.status(400).json({ error: 'location_id and table_number required' });
  try {
    const r = db.prepare(`INSERT INTO tables (location_id, table_number, capacity, area_id, status) VALUES (?,?,?,?,?)`).run(locId, table_number, capacity || 4, area_id || null, 'empty');
    res.json({ id: r.lastInsertRowid, success: true });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Table number already exists at this location' });
    console.error('POST /tables:', e);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// PUT /tables/:id — update status and/or table metadata
router.put('/:id', requireRole('owner','manager','frontdesk','waiter','chef','employee','stockroom'), (req, res) => {
  const { status, table_number, capacity, area_id } = req.body;
  const metaChange = table_number !== undefined || capacity !== undefined || area_id !== undefined;
  if (metaChange && !['owner','manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only owner or manager can update table structure' });
  }
  // Changing a table's live status is a floor operation: non-owner staff must be on the clock.
  if (status !== undefined && req.user.role !== 'owner' && !isOnDuty(req.user.id)) {
    return res.status(403).json({ error: 'You must be clocked in to update table status. Please clock in first.' });
  }
  const fields = [], vals = [];
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    fields.push('status=?'); vals.push(status);
  }
  if (table_number !== undefined) { fields.push('table_number=?'); vals.push(table_number); }
  if (capacity !== undefined)     { fields.push('capacity=?');     vals.push(capacity); }
  if (area_id !== undefined)      { fields.push('area_id=?');      vals.push(area_id || null); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE tables SET ${fields.join(',')} WHERE id=?`).run(...vals);
  const updated = db.prepare(`
    SELECT t.*, a.name as area_name, a.color as area_color
    FROM tables t LEFT JOIN areas a ON t.area_id = a.id WHERE t.id=?
  `).get(req.params.id);
  broadcast('table_update', { table_id: updated.id, status: updated.status, location_id: updated.location_id }, updated.location_id);
  if (updated.status === 'need_help') {
    notify(`Table ${updated.table_number} needs assistance`, { locId: updated.location_id, roles: ['manager','waiter','employee','frontdesk'], kind: 'help' });
  }
  res.json(updated);
});

// DELETE /tables/:id
router.delete('/:id', requireRole('owner','manager'), (req, res) => {
  db.prepare(`DELETE FROM tables WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
