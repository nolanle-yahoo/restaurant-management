// Staff scheduling — weekly shifts. Foundation for future shift-swapping.
const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// The signed-in staff member's own upcoming shifts (today onward).
router.get('/mine', (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, l.name as location_name
    FROM schedules s LEFT JOIN locations l ON s.location_id=l.id
    WHERE s.user_id=? AND s.work_date >= date('now')
    ORDER BY s.work_date, s.shift_start LIMIT 60
  `).all(req.user.id);
  res.json(rows);
});

// Shifts for a location over a date range (owner/manager).
router.get('/', requireRole('owner', 'manager'), (req, res) => {
  const locId = req.user.role === 'owner' ? (req.query.location_id || null) : req.user.location_id;
  const start = req.query.start, end = req.query.end;
  if (!start || !end) return res.status(400).json({ error: 'start and end dates required (YYYY-MM-DD)' });
  const locCond = locId ? 'AND s.location_id=?' : '';
  const args = [start, end, ...(locId ? [locId] : [])];
  const rows = db.prepare(`
    SELECT s.*, u.name as user_name, u.role as user_role
    FROM schedules s JOIN users u ON s.user_id=u.id
    WHERE s.work_date >= ? AND s.work_date <= ? ${locCond}
    ORDER BY s.work_date, s.shift_start, u.name
  `).all(...args);
  res.json(rows);
});

router.post('/', requireRole('owner', 'manager'), (req, res) => {
  const { user_id, work_date, shift_start, shift_end } = req.body;
  if (!user_id || !work_date || !shift_start || !shift_end) return res.status(400).json({ error: 'user, date, start and end are required.' });
  if (!HHMM.test(shift_start) || !HHMM.test(shift_end)) return res.status(400).json({ error: 'Times must be HH:MM.' });
  const emp = db.prepare(`SELECT id, location_id FROM users WHERE id=? AND is_active=1`).get(user_id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  const locId = req.user.role === 'owner' ? (emp.location_id || req.body.location_id) : req.user.location_id;
  if (req.user.role === 'manager' && emp.location_id !== req.user.location_id) {
    return res.status(403).json({ error: 'You can only schedule staff at your location.' });
  }
  const r = db.prepare(`INSERT INTO schedules (user_id, location_id, work_date, shift_start, shift_end, created_by) VALUES (?,?,?,?,?,?)`)
    .run(user_id, locId, work_date, shift_start, shift_end, req.user.id);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/:id', requireRole('owner', 'manager'), (req, res) => {
  const s = db.prepare(`SELECT * FROM schedules WHERE id=?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Shift not found' });
  if (req.user.role === 'manager' && s.location_id !== req.user.location_id) return res.status(403).json({ error: 'Not your location.' });
  const fields = [], vals = [];
  ['work_date', 'shift_start', 'shift_end'].forEach(k => {
    if (req.body[k] !== undefined) {
      if ((k === 'shift_start' || k === 'shift_end') && !HHMM.test(req.body[k])) return;
      fields.push(`${k}=?`); vals.push(req.body[k]);
    }
  });
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(s.id);
  db.prepare(`UPDATE schedules SET ${fields.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});

router.delete('/:id', requireRole('owner', 'manager'), (req, res) => {
  const s = db.prepare(`SELECT * FROM schedules WHERE id=?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Shift not found' });
  if (req.user.role === 'manager' && s.location_id !== req.user.location_id) return res.status(403).json({ error: 'Not your location.' });
  db.prepare(`DELETE FROM schedules WHERE id=?`).run(s.id);
  res.json({ success: true });
});

module.exports = router;
