const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

router.get('/', requireRole('owner','manager'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const query = locId
    ? db.prepare(`SELECT u.id,u.name,u.email,u.role,u.location_id,u.is_active,u.created_at,l.name as location_name FROM users u LEFT JOIN locations l ON u.location_id=l.id WHERE u.location_id=? AND u.role!='owner' ORDER BY u.name`).all(locId)
    : db.prepare(`SELECT u.id,u.name,u.email,u.role,u.location_id,u.is_active,u.created_at,l.name as location_name FROM users u LEFT JOIN locations l ON u.location_id=l.id WHERE u.role!='owner' ORDER BY l.name,u.name`).all();
  // Attach today's clock status
  const clocked = db.prepare(`SELECT user_id FROM clock_records WHERE check_out IS NULL AND date(check_in)=date('now')`).all().map(r=>r.user_id);
  res.json(query.map(u=>({...u, clocked_in: clocked.includes(u.id)})));
});

router.put('/:id', requireRole('owner','manager'), (req, res) => {
  const { role, location_id, is_active } = req.body;
  const fields = [], vals = [];
  if (role)        { fields.push('role=?');        vals.push(role); }
  if (location_id) { fields.push('location_id=?'); vals.push(location_id); }
  if (is_active !== undefined) { fields.push('is_active=?'); vals.push(is_active ? 1 : 0); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});

router.get('/on-duty', requireRole('owner','manager'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const cond = locId ? 'AND c.location_id=?' : '';
  const args = locId ? [locId] : [];
  const rows = db.prepare(`
    SELECT u.id,u.name,u.role,c.check_in,c.location_id,l.name as location_name
    FROM clock_records c JOIN users u ON c.user_id=u.id LEFT JOIN locations l ON c.location_id=l.id
    WHERE c.check_out IS NULL AND date(c.check_in)=date('now') ${cond}
    ORDER BY c.check_in
  `).all(...args);
  res.json(rows);
});

module.exports = router;
