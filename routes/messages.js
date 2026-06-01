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
    WHERE m.parent_id IS NULL ${cond}
    ORDER BY m.is_read ASC, m.created_at DESC
  `).all(...args);
  res.json(attachReplies(rows));
});

// Attach threaded replies (children) to a set of top-level messages.
function attachReplies(rows) {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const replies = db.prepare(`
    SELECT r.*, u.name as sender_name, u.role as sender_role
    FROM employee_messages r JOIN users u ON r.user_id=u.id
    WHERE r.parent_id IN (${ids.map(()=>'?').join(',')})
    ORDER BY r.created_at ASC
  `).all(...ids);
  const byParent = {};
  replies.forEach(r => { (byParent[r.parent_id] = byParent[r.parent_id] || []).push(r); });
  return rows.map(r => ({ ...r, replies: byParent[r.id] || [] }));
}

// Employee — their own sent messages, each with any staff replies.
router.get('/mine', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM employee_messages WHERE user_id=? AND parent_id IS NULL ORDER BY created_at DESC
  `).all(req.user.id);
  res.json(attachReplies(rows));
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

// Owner/manager reply to a message (threaded). The reply is visible to the
// original sender on their "my messages" view.
router.post('/:id/reply', requireRole('owner','manager'), (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const parent = db.prepare(`SELECT * FROM employee_messages WHERE id=? AND parent_id IS NULL`).get(req.params.id);
  if (!parent) return res.status(404).json({ error: 'Message not found' });
  const r = db.prepare(`
    INSERT INTO employee_messages (user_id, location_id, recipient_type, subject, message, parent_id, is_read)
    VALUES (?,?,?,?,?,?,1)
  `).run(req.user.id, parent.location_id, parent.recipient_type, 'Re: ' + parent.subject, message, parent.id);
  db.prepare(`UPDATE employee_messages SET is_read=1 WHERE id=?`).run(parent.id);
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
  db.prepare(`DELETE FROM employee_messages WHERE parent_id=?`).run(req.params.id); // remove thread replies first (FK)
  db.prepare(`DELETE FROM employee_messages WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
