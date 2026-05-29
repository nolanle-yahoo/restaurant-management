const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

// GET /areas?location_id= — areas with table count and assigned waiters
router.get('/', requireRole('owner','manager','frontdesk','waiter','chef','stockroom','employee'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  if (!locId) return res.status(400).json({ error: 'location_id required' });

  const areas = db.prepare(`
    SELECT a.*,
           COUNT(DISTINCT t.id) as table_count
    FROM areas a
    LEFT JOIN tables t ON t.area_id = a.id
    WHERE a.location_id = ?
    GROUP BY a.id
    ORDER BY a.sort_order, a.name
  `).all(locId);

  // Attach assigned staff per area
  const assignments = db.prepare(`
    SELECT wa.id as assignment_id, wa.area_id, u.id, u.name, u.role
    FROM waiter_assignments wa
    JOIN users u ON wa.user_id = u.id
    WHERE wa.area_id IN (SELECT id FROM areas WHERE location_id = ?)
  `).all(locId);

  areas.forEach(a => {
    a.waiters = assignments.filter(w => w.area_id === a.id);
  });

  res.json(areas);
});

// GET /areas/assignments?location_id= — all waiter→area assignments for a location
router.get('/assignments', requireRole('owner','manager'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  if (!locId) return res.status(400).json({ error: 'location_id required' });

  const rows = db.prepare(`
    SELECT wa.*, u.name as waiter_name, u.role as waiter_role,
           a.name as area_name, ab.name as assigned_by_name
    FROM waiter_assignments wa
    JOIN users u ON wa.user_id = u.id
    JOIN areas a ON wa.area_id = a.id
    LEFT JOIN users ab ON wa.assigned_by = ab.id
    WHERE a.location_id = ?
    ORDER BY a.sort_order, u.name
  `).all(locId);
  res.json(rows);
});

// POST /areas/assignments — assign a waiter to an area
router.post('/assignments', requireRole('owner','manager'), (req, res) => {
  const { user_id, area_id } = req.body;
  if (!user_id || !area_id) return res.status(400).json({ error: 'user_id and area_id required' });

  const waiter = db.prepare(`SELECT * FROM users WHERE id = ? AND is_active = 1`).get(user_id);
  if (!waiter) return res.status(404).json({ error: 'Employee not found' });

  try {
    db.prepare(`INSERT INTO waiter_assignments (user_id, area_id, assigned_by) VALUES (?,?,?)`).run(user_id, area_id, req.user.id);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'Assignment already exists' });
  }
});

// DELETE /areas/assignments/:id — remove a waiter assignment
router.delete('/assignments/:id', requireRole('owner','manager'), (req, res) => {
  db.prepare(`DELETE FROM waiter_assignments WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

// POST /areas — create a new area
router.post('/', requireRole('owner','manager'), (req, res) => {
  const { location_id, name, color, sort_order } = req.body;
  const locId = req.user.role === 'owner' ? location_id : req.user.location_id;
  if (!locId || !name) return res.status(400).json({ error: 'location_id and name required' });
  const r = db.prepare(`INSERT INTO areas (location_id, name, color, sort_order) VALUES (?,?,?,?)`).run(locId, name, color || '#6B1A1A', sort_order || 0);
  res.json({ id: r.lastInsertRowid, success: true });
});

// PUT /areas/:id — update area name/color
router.put('/:id', requireRole('owner','manager'), (req, res) => {
  const { name, color, sort_order } = req.body;
  const fields = [], vals = [];
  if (name !== undefined)       { fields.push('name=?');       vals.push(name); }
  if (color !== undefined)      { fields.push('color=?');      vals.push(color); }
  if (sort_order !== undefined) { fields.push('sort_order=?'); vals.push(sort_order); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE areas SET ${fields.join(',')} WHERE id = ?`).run(...vals);
  res.json({ success: true });
});

// DELETE /areas/:id — delete area (unassigns tables first)
router.delete('/:id', requireRole('owner','manager'), (req, res) => {
  db.prepare(`UPDATE tables SET area_id = NULL WHERE area_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM waiter_assignments WHERE area_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM areas WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
