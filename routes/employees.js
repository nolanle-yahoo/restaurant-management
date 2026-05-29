const express = require('express');
const bcrypt  = require('bcryptjs');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

router.get('/', requireRole('owner','manager'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const query = locId
    ? db.prepare(`SELECT u.id,u.name,u.email,u.role,u.location_id,u.hourly_rate,u.is_active,u.created_at,l.name as location_name FROM users u LEFT JOIN locations l ON u.location_id=l.id WHERE u.location_id=? AND u.role!='owner' ORDER BY u.name`).all(locId)
    : db.prepare(`SELECT u.id,u.name,u.email,u.role,u.location_id,u.hourly_rate,u.is_active,u.created_at,l.name as location_name FROM users u LEFT JOIN locations l ON u.location_id=l.id WHERE u.role!='owner' ORDER BY l.name,u.name`).all();
  const clocked = db.prepare(`SELECT user_id FROM clock_records WHERE check_out IS NULL AND date(check_in)=date('now')`).all().map(r=>r.user_id);
  res.json(query.map(u=>({...u, clocked_in: clocked.includes(u.id)})));
});

// Get all employees including owner (admin view)
router.get('/all', requireRole('owner'), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id,u.name,u.email,u.role,u.location_id,u.hourly_rate,u.is_active,u.created_at,
           l.name as location_name
    FROM users u LEFT JOIN locations l ON u.location_id=l.id
    ORDER BY u.role, u.name
  `).all();
  const clocked = db.prepare(`SELECT user_id FROM clock_records WHERE check_out IS NULL AND date(check_in)=date('now')`).all().map(r=>r.user_id);
  res.json(rows.map(u=>({...u, clocked_in: clocked.includes(u.id)})));
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

router.get('/:id', requireRole('owner','manager'), (req, res) => {
  const emp = db.prepare(`
    SELECT u.id,u.name,u.email,u.role,u.location_id,u.hourly_rate,u.is_active,u.created_at,
           l.name as location_name
    FROM users u LEFT JOIN locations l ON u.location_id=l.id WHERE u.id=?
  `).get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  res.json(emp);
});

router.post('/', requireRole('owner','manager'), (req, res) => {
  const { name, email, password, role, location_id, hourly_rate } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'name, email, password, role required' });
  const validRoles = req.user.role === 'owner'
    ? ['owner','manager','stockroom','employee','frontdesk','waiter','chef']
    : ['manager','stockroom','employee','frontdesk','waiter','chef'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  // Managers can only create employees in their own location; owners with owner role get no location
  const locId = req.user.role === 'manager' ? req.user.location_id
              : role === 'owner' ? null
              : (location_id || null);
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare(`INSERT INTO users (name, email, password_hash, role, location_id, hourly_rate) VALUES (?,?,?,?,?,?)`).run(name, email, hash, role, locId, hourly_rate || 0);
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    throw e;
  }
});

router.put('/:id', requireRole('owner','manager'), (req, res) => {
  const { name, email, password, role, location_id, hourly_rate, is_active } = req.body;
  const fields = [], vals = [];
  if (name)                    { fields.push('name=?');        vals.push(name); }
  if (email)                   { fields.push('email=?');       vals.push(email); }
  if (password)                { fields.push('password_hash=?'); vals.push(bcrypt.hashSync(password, 10)); }
  if (role)                    { fields.push('role=?');        vals.push(role); }
  if (location_id !== undefined){ fields.push('location_id=?'); vals.push(location_id || null); }
  if (hourly_rate !== undefined){ fields.push('hourly_rate=?'); vals.push(hourly_rate); }
  if (is_active !== undefined) { fields.push('is_active=?');   vals.push(is_active ? 1 : 0); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  try {
    db.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).run(...vals);
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    throw e;
  }
});

router.delete('/:id', requireRole('owner'), (req, res) => {
  const emp = db.prepare(`SELECT role FROM users WHERE id=?`).get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  // Prevent deactivating the last active owner
  if (emp.role === 'owner') {
    const activeOwners = db.prepare(`SELECT COUNT(*) as n FROM users WHERE role='owner' AND is_active=1`).get();
    if (activeOwners.n <= 1) return res.status(403).json({ error: 'Cannot deactivate the last active owner account' });
  }
  // Soft-delete: deactivate and anonymise instead of hard delete to preserve clock records
  db.prepare(`UPDATE users SET is_active=0, email=email||'_deleted_'||id WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
