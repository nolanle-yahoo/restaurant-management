const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

const VALID_STATUSES = ['empty','occupied','waiting_order','ordered','waiting_food','need_help','waiting_payment','special_request','ready_clean','cleaning'];

// GET /tables?location_id= — all tables with area info and assigned waiter
router.get('/', requireRole('owner','manager','frontdesk','waiter','chef','employee'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  if (!locId) return res.status(400).json({ error: 'location_id required' });

  const rows = db.prepare(`
    SELECT t.*, a.name as area_name, a.color as area_color,
           u.name as waiter_name, u.id as waiter_id
    FROM tables t
    LEFT JOIN areas a ON t.area_id = a.id
    LEFT JOIN waiter_assignments wa ON wa.area_id = t.area_id
    LEFT JOIN users u ON wa.user_id = u.id
    WHERE t.location_id = ?
    ORDER BY a.sort_order, t.table_number
  `).all(locId);
  res.json(rows);
});

// GET /tables/by-area?location_id= — tables grouped by area
router.get('/by-area', requireRole('owner','manager','frontdesk','waiter','chef','employee'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  if (!locId) return res.status(400).json({ error: 'location_id required' });

  const areas = db.prepare(`SELECT * FROM areas WHERE location_id = ? ORDER BY sort_order, name`).all(locId);
  const tables = db.prepare(`
    SELECT t.*, u.name as waiter_name
    FROM tables t
    LEFT JOIN waiter_assignments wa ON wa.area_id = t.area_id
    LEFT JOIN users u ON wa.user_id = u.id
    WHERE t.location_id = ?
    ORDER BY t.table_number
  `).all(locId);

  const result = areas.map(a => ({
    ...a,
    tables: tables.filter(t => t.area_id === a.id),
  }));

  // Unassigned tables
  const unassigned = tables.filter(t => !t.area_id);
  if (unassigned.length) result.push({ id: null, name: 'Unassigned', color: '#999', tables: unassigned });

  res.json(result);
});

// PUT /tables/:id — update status
router.put('/:id', requireRole('owner','manager','frontdesk','waiter','chef','employee'), (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`UPDATE tables SET status = ? WHERE id = ?`).run(status, req.params.id);
  const updated = db.prepare(`
    SELECT t.*, a.name as area_name, a.color as area_color
    FROM tables t LEFT JOIN areas a ON t.area_id = a.id
    WHERE t.id = ?
  `).get(req.params.id);
  res.json(updated);
});

module.exports = router;
