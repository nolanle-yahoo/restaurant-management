const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

router.get('/', (req, res) => {
  const { role, id: userId, location_id: locId } = req.user;

  let query, args;
  if (role === 'owner') {
    const locFilter = req.query.location_id ? 'AND u.location_id=?' : '';
    query = `
      SELECT t.*, u.name as employee_name, u.role as employee_role,
             l.name as location_name, r.name as reviewed_by_name
      FROM time_off_requests t
      JOIN users u ON t.user_id=u.id
      LEFT JOIN locations l ON t.location_id=l.id
      LEFT JOIN users r ON t.reviewed_by=r.id
      WHERE 1=1 ${locFilter} ORDER BY t.created_at DESC`;
    args = req.query.location_id ? [req.query.location_id] : [];
  } else if (role === 'manager') {
    query = `
      SELECT t.*, u.name as employee_name, u.role as employee_role,
             l.name as location_name, r.name as reviewed_by_name
      FROM time_off_requests t
      JOIN users u ON t.user_id=u.id
      LEFT JOIN locations l ON t.location_id=l.id
      LEFT JOIN users r ON t.reviewed_by=r.id
      WHERE t.location_id=? ORDER BY t.created_at DESC`;
    args = [locId];
  } else {
    query = `
      SELECT t.*, r.name as reviewed_by_name
      FROM time_off_requests t
      LEFT JOIN users r ON t.reviewed_by=r.id
      WHERE t.user_id=? ORDER BY t.created_at DESC`;
    args = [userId];
  }
  res.json(db.prepare(query).all(...args));
});

router.post('/', (req, res) => {
  const { type, start_date, end_date, reason } = req.body;
  if (!type || !start_date || !end_date) return res.status(400).json({ error: 'type, start_date and end_date required' });
  if (!['vacation','sick','personal','other'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const r = db.prepare(`
    INSERT INTO time_off_requests (user_id, location_id, type, start_date, end_date, reason)
    VALUES (?,?,?,?,?,?)
  `).run(req.user.id, req.user.location_id, type, start_date, end_date, reason || null);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { role, id: userId } = req.user;
  const existing = db.prepare(`SELECT * FROM time_off_requests WHERE id=?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found' });

  if (role === 'owner' || role === 'manager') {
    const { status, review_note } = req.body;
    if (!['approved','denied'].includes(status)) return res.status(400).json({ error: 'Status must be approved or denied' });
    db.prepare(`UPDATE time_off_requests SET status=?, reviewed_by=?, review_note=?, updated_at=datetime('now') WHERE id=?`)
      .run(status, userId, review_note || null, req.params.id);
  } else {
    if (existing.user_id !== userId) return res.status(403).json({ error: 'Not your request' });
    if (existing.status !== 'pending') return res.status(400).json({ error: 'Can only cancel pending requests' });
    db.prepare(`UPDATE time_off_requests SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  }
  res.json({ success: true });
});

module.exports = router;
