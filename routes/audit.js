const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);
router.use(requireRole('owner', 'manager'));

router.get('/', (req, res) => {
  const { role, location_id: locId } = req.user;
  const filterLocId = role === 'owner' ? req.query.location_id : locId;
  const action = req.query.action || '';
  const { start, end } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);

  let sql = `SELECT * FROM audit_log WHERE 1=1`;
  const args = [];
  if (filterLocId) { sql += ' AND (location_id=? OR location_id IS NULL)'; args.push(filterLocId); }
  if (action)      { sql += ' AND action LIKE ?'; args.push(`%${action}%`); }
  if (start)       { sql += ' AND date(created_at) >= date(?)'; args.push(start); }
  if (end)         { sql += ' AND date(created_at) <= date(?)'; args.push(end); }
  sql += ` ORDER BY created_at DESC LIMIT ${limit}`;

  res.json(db.prepare(sql).all(...args));
});

module.exports = router;
