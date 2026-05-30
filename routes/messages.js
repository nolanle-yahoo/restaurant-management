const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

// Manager/owner inbox
router.get('/', requireRole('owner','manager'), (req, res) => {
  const { role, location_id: locId } = req.user;
  let cond, args;
  if (role === 'manager') {
    cond = `AND (m.recipient_type='manager' OR m.recipient_type='both') AND m.location_id=?`;
    args = [locId];
  } else {
    // Owner sees ALL messages from all locations (full visibility)
    const locFilter = req.query.location_id ? 'AND m.location_id=?' : '';
    cond = locFilter;
    args = req.query.location_id ? [req.query.location_id] : [];
  }
  const rows = db.prepare(`
    SELECT m.*, u.name as sender_name, u.role as sender_role, l.name as location_name
    FROM employee_messages m
    JOIN users u ON m.user_id=u.id
    LEFT JOIN locations l ON m.location_id=l.id
    WHERE 1=1 ${cond}
    ORDER BY m.is_read ASC, m.created_at DESC
  `).all(...args);
  res.json(rows);
});

// Employee — their own sent messages
router.get('/mine', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM employee_messages WHERE user_id=? ORDER BY created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

// Send a message
router.post('/', (req, res) => {
  const { recipient_type, subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message required' });
  const recType = ['manager','owner','both'].includes(recipient_type) ? recipient_type : 'manager';
  const r = db.prepare(`
    INSERT INTO employee_messages (user_id, location_id, recipient_type, subject, message)
    VALUES (?,?,?,?,?)
  `).run(req.user.id, req.user.location_id, recType, subject, message);
  res.json({ success: true, id: r.lastInsertRowid });
});

// Mark as read
router.put('/:id/read', requireRole('owner','manager'), (req, res) => {
  db.prepare(`UPDATE employee_messages SET is_read=1 WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

// Delete
router.delete('/:id', (req, res) => {
  const msg = db.prepare(`SELECT * FROM employee_messages WHERE id=?`).get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const { role, id: userId } = req.user;
  if (role !== 'owner' && role !== 'manager' && msg.user_id !== userId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  db.prepare(`DELETE FROM employee_messages WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
