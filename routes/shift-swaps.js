// Shift swapping — staff offer an upcoming shift to a colleague (open or targeted),
// a colleague claims it, and an owner/manager approves the hand-over. Built on the
// scheduling base (db/schedules).
const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLog } = require('../lib/audit');
const { notify } = require('../lib/ws');

const router = express.Router();
router.use(verifyToken);

const SELECT = `
  SELECT sw.*,
         s.work_date, s.shift_start, s.shift_end,
         r.name AS requester_name, r.role AS requester_role,
         a.name AS accepted_by_name,
         t.name AS target_name,
         l.name AS location_name
  FROM shift_swaps sw
  JOIN schedules s ON sw.shift_id = s.id
  JOIN users r ON sw.requester_id = r.id
  LEFT JOIN users a ON sw.accepted_by = a.id
  LEFT JOIN users t ON sw.target_user_id = t.id
  LEFT JOIN locations l ON sw.location_id = l.id
`;

// List swaps relevant to the caller.
//  - owner: all (optional ?location_id), or their managed scope
//  - manager: their location
//  - staff: their own requests, ones they accepted/were targeted for, and open offers
//    at their location they could claim
router.get('/', (req, res) => {
  const { role, id: uid, location_id: myLoc } = req.user;
  let where, args;
  if (role === 'owner') {
    const loc = req.query.location_id;
    where = loc ? 'sw.location_id = ?' : '1=1';
    args = loc ? [loc] : [];
  } else if (role === 'manager') {
    where = 'sw.location_id = ?';
    args = [myLoc];
  } else {
    where = `(
      sw.requester_id = ?
      OR sw.accepted_by = ?
      OR sw.target_user_id = ?
      OR (sw.status = 'open' AND sw.target_user_id IS NULL AND sw.location_id = ? AND sw.requester_id != ?)
    )`;
    args = [uid, uid, uid, myLoc, uid];
  }
  const rows = db.prepare(`${SELECT} WHERE ${where} ORDER BY sw.created_at DESC LIMIT 200`).all(...args);
  res.json(rows);
});

// Staff offers one of their own upcoming shifts.
router.post('/', (req, res) => {
  const { shift_id, target_user_id, note } = req.body;
  if (!shift_id) return res.status(400).json({ error: 'shift_id is required.' });
  const shift = db.prepare(`SELECT * FROM schedules WHERE id=?`).get(shift_id);
  if (!shift) return res.status(404).json({ error: 'Shift not found.' });
  if (shift.user_id !== req.user.id) return res.status(403).json({ error: 'You can only offer your own shifts.' });
  const future = db.prepare(`SELECT 1 AS ok WHERE ? >= date('now')`).get(shift.work_date);
  if (!future) return res.status(400).json({ error: 'You can only offer upcoming shifts.' });
  const existing = db.prepare(`SELECT id FROM shift_swaps WHERE shift_id=? AND status IN ('open','accepted')`).get(shift_id);
  if (existing) return res.status(409).json({ error: 'A swap is already in progress for this shift.' });

  let target = null;
  if (target_user_id) {
    target = db.prepare(`SELECT id, location_id FROM users WHERE id=? AND is_active=1`).get(target_user_id);
    if (!target) return res.status(404).json({ error: 'Target colleague not found.' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot offer a shift to yourself.' });
    if (target.location_id !== shift.location_id) return res.status(400).json({ error: 'Colleague must be at the same location.' });
  }

  const r = db.prepare(`
    INSERT INTO shift_swaps (shift_id, requester_id, location_id, target_user_id, note)
    VALUES (?,?,?,?,?)
  `).run(shift_id, req.user.id, shift.location_id, target_user_id || null, note || null);
  auditLog(req, 'shift_swap_requested', 'shift_swap', r.lastInsertRowid, { shift_id, target_user_id: target_user_id || null });
  notify(`${req.user.name} is offering a shift on ${shift.work_date}`, { locId: shift.location_id, kind: 'info' });
  res.json({ success: true, id: r.lastInsertRowid });
});

// A colleague claims an open offer, or the named target accepts.
router.post('/:id/accept', (req, res) => {
  const sw = db.prepare(`SELECT * FROM shift_swaps WHERE id=?`).get(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Swap not found.' });
  if (sw.status !== 'open') return res.status(409).json({ error: 'This swap is no longer open.' });
  if (sw.requester_id === req.user.id) return res.status(400).json({ error: 'You cannot accept your own offer.' });
  if (sw.target_user_id && sw.target_user_id !== req.user.id) {
    return res.status(403).json({ error: 'This offer is directed to another colleague.' });
  }
  // Open offers: only active staff at the same location may claim.
  const me = db.prepare(`SELECT location_id, is_active FROM users WHERE id=?`).get(req.user.id);
  if (!me || !me.is_active || me.location_id !== sw.location_id) {
    return res.status(403).json({ error: 'You are not eligible to take this shift.' });
  }
  db.prepare(`UPDATE shift_swaps SET accepted_by=?, status='accepted' WHERE id=?`).run(req.user.id, sw.id);
  auditLog(req, 'shift_swap_accepted', 'shift_swap', sw.id, {});
  notify(`${req.user.name} accepted a shift swap — awaiting approval`, { locId: sw.location_id, roles: ['owner', 'manager'], kind: 'info' });
  res.json({ success: true });
});

// Owner/manager approves: the shift is reassigned to the colleague who accepted.
router.post('/:id/approve', requireRole('owner', 'manager'), (req, res) => {
  const sw = db.prepare(`SELECT * FROM shift_swaps WHERE id=?`).get(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Swap not found.' });
  if (req.user.role === 'manager' && sw.location_id !== req.user.location_id) return res.status(403).json({ error: 'Not your location.' });
  if (sw.status !== 'accepted') return res.status(409).json({ error: 'Only accepted swaps can be approved.' });

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE schedules SET user_id=? WHERE id=?`).run(sw.accepted_by, sw.shift_id);
    db.prepare(`UPDATE shift_swaps SET status='approved', reviewed_by=?, decided_at=datetime('now') WHERE id=?`).run(req.user.id, sw.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  auditLog(req, 'shift_swap_approved', 'shift_swap', sw.id, { shift_id: sw.shift_id, new_owner: sw.accepted_by });
  notify('A shift swap was approved', { locId: sw.location_id, kind: 'info' });
  res.json({ success: true });
});

// Owner/manager rejects an open or accepted swap.
router.post('/:id/reject', requireRole('owner', 'manager'), (req, res) => {
  const sw = db.prepare(`SELECT * FROM shift_swaps WHERE id=?`).get(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Swap not found.' });
  if (req.user.role === 'manager' && sw.location_id !== req.user.location_id) return res.status(403).json({ error: 'Not your location.' });
  if (!['open', 'accepted'].includes(sw.status)) return res.status(409).json({ error: 'This swap is already resolved.' });
  db.prepare(`UPDATE shift_swaps SET status='rejected', reviewed_by=?, decided_at=datetime('now') WHERE id=?`).run(req.user.id, sw.id);
  auditLog(req, 'shift_swap_rejected', 'shift_swap', sw.id, {});
  res.json({ success: true });
});

// Requester cancels their own open/accepted request (owner/manager may also cancel).
router.delete('/:id', (req, res) => {
  const sw = db.prepare(`SELECT * FROM shift_swaps WHERE id=?`).get(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Swap not found.' });
  const isStaffOwnerOfReq = sw.requester_id === req.user.id;
  const isMgr = req.user.role === 'owner' || (req.user.role === 'manager' && sw.location_id === req.user.location_id);
  if (!isStaffOwnerOfReq && !isMgr) return res.status(403).json({ error: 'Not allowed.' });
  if (!['open', 'accepted'].includes(sw.status)) return res.status(409).json({ error: 'This swap is already resolved.' });
  db.prepare(`UPDATE shift_swaps SET status='cancelled', decided_at=datetime('now') WHERE id=?`).run(sw.id);
  auditLog(req, 'shift_swap_cancelled', 'shift_swap', sw.id, {});
  res.json({ success: true });
});

module.exports = router;
