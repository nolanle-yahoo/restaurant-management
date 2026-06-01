// Broadcast announcements from owner/manager to staff. Persisted for later
// viewing and pushed live as toasts via the WebSocket notify bus.

const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { notify } = require('../lib/ws');
const { auditLog } = require('../lib/audit');

const router = express.Router();
router.use(verifyToken);

// List announcements relevant to the caller: global (location_id NULL) plus
// those for their location. Owners see everything.
router.get('/', (req, res) => {
  let rows;
  if (req.user.role === 'owner') {
    rows = db.prepare(`
      SELECT a.*, l.name as location_name FROM announcements a
      LEFT JOIN locations l ON a.location_id=l.id
      ORDER BY a.created_at DESC LIMIT 50
    `).all();
  } else {
    rows = db.prepare(`
      SELECT a.*, l.name as location_name FROM announcements a
      LEFT JOIN locations l ON a.location_id=l.id
      WHERE a.location_id IS NULL OR a.location_id=?
      ORDER BY a.created_at DESC LIMIT 50
    `).all(req.user.location_id);
  }
  res.json(rows);
});

// Post an announcement. Managers post to their own location; owners may target a
// location or post globally (location_id omitted/null).
router.post('/', requireRole('owner', 'manager'), (req, res) => {
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required.' });
  const locId = req.user.role === 'owner' ? (req.body.location_id || null) : req.user.location_id;

  const r = db.prepare(`INSERT INTO announcements (location_id, author_id, author_name, title, body) VALUES (?,?,?,?,?)`)
    .run(locId, req.user.id, req.user.name, title, body);
  // Live toast to staff (location-scoped, or everyone for a global announcement).
  notify(`📣 ${title}`, { locId: locId || null, roles: null, kind: 'announcement' });
  auditLog(req, 'announcement_post', 'announcement', r.lastInsertRowid, { title, location_id: locId });
  res.json({ success: true, id: r.lastInsertRowid });
});

router.delete('/:id', requireRole('owner', 'manager'), (req, res) => {
  const a = db.prepare(`SELECT * FROM announcements WHERE id=?`).get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'manager' && a.location_id !== req.user.location_id) {
    return res.status(403).json({ error: 'You can only remove your location\'s announcements.' });
  }
  db.prepare(`DELETE FROM announcements WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
