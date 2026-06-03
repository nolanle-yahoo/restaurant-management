// Staff view of guest feedback (owner: all locations; manager: own location).
const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

router.get('/', requireRole('owner', 'manager'), (req, res) => {
  const locId = req.user.role === 'owner' ? (req.query.location_id || null) : req.user.location_id;
  const { start, end } = req.query;
  const clauses = [], args = [];
  if (locId) { clauses.push('f.location_id=?'); args.push(locId); }
  if (start) { clauses.push('date(f.created_at) >= date(?)'); args.push(start); }
  if (end)   { clauses.push('date(f.created_at) <= date(?)'); args.push(end); }
  const cond = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT f.id, f.receipt_code, f.rating, f.comment, f.created_at, f.source, f.reference_code, f.customer_name, l.name as location_name
    FROM feedback f LEFT JOIN locations l ON f.location_id=l.id
    ${cond} ORDER BY f.created_at DESC LIMIT 200
  `).all(...args);
  const agg = db.prepare(`SELECT COUNT(*) n, COALESCE(AVG(rating),0) avg FROM feedback f ${cond}`).get(...args);
  res.json({ count: agg.n, average: Math.round(agg.avg * 100) / 100, items: rows });
});

module.exports = router;
