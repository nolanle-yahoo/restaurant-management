const express = require('express');
const db = require('../db/database');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

router.post('/in', (req, res) => {
  const existing = db.prepare(`SELECT id FROM clock_records WHERE user_id=? AND check_out IS NULL`).get(req.user.id);
  if (existing) return res.status(400).json({ error: 'Already clocked in' });
  db.prepare(`INSERT INTO clock_records (user_id, location_id, check_in) VALUES (?,?,datetime('now'))`).run(req.user.id, req.user.location_id);
  res.json({ success: true, message: 'Clocked in successfully' });
});

router.post('/out', (req, res) => {
  const record = db.prepare(`SELECT id, check_in FROM clock_records WHERE user_id=? AND check_out IS NULL`).get(req.user.id);
  if (!record) return res.status(400).json({ error: 'Not currently clocked in' });
  db.prepare(`
    UPDATE clock_records SET check_out=datetime('now'),
    hours_worked=round((julianday('now')-julianday(check_in))*24, 2)
    WHERE id=?
  `).run(record.id);
  const updated = db.prepare(`SELECT * FROM clock_records WHERE id=?`).get(record.id);
  res.json({ success: true, hours_worked: updated.hours_worked });
});

router.get('/status', (req, res) => {
  const record = db.prepare(`SELECT * FROM clock_records WHERE user_id=? AND check_out IS NULL`).get(req.user.id);
  res.json({ clocked_in: !!record, record: record || null });
});

router.get('/hours', (req, res) => {
  const userId = req.query.user_id || req.user.id;
  const week   = req.query.week || 0;
  const rows = db.prepare(`
    SELECT date(check_in) as work_date,
           time(check_in) as clock_in_time,
           time(check_out) as clock_out_time,
           hours_worked
    FROM clock_records
    WHERE user_id=? AND check_out IS NOT NULL
      AND date(check_in) >= date('now', ? || ' days')
      AND date(check_in) <= date('now', ? || ' days')
    ORDER BY check_in DESC
  `).all(userId, String(Number(week)*-7 - 6), String(Number(week)*-7));
  const total = rows.reduce((s, r) => s + (r.hours_worked || 0), 0);
  res.json({ records: rows, total_hours: Math.round(total * 100) / 100 });
});

router.get('/recent', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, u.name, u.role, l.name as location_name
    FROM clock_records c JOIN users u ON c.user_id=u.id LEFT JOIN locations l ON c.location_id=l.id
    ORDER BY c.check_in DESC LIMIT 20
  `).all();
  res.json(rows);
});

module.exports = router;
