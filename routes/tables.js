const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

router.get('/', requireRole('owner','manager','frontdesk','waiter'), (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  if (!locId) return res.status(400).json({ error: 'location_id required' });
  const rows = db.prepare(`SELECT * FROM tables WHERE location_id=? ORDER BY table_number`).all(locId);
  res.json(rows);
});

router.put('/:id', requireRole('owner','manager','frontdesk','waiter'), (req, res) => {
  const { status } = req.body;
  const valid = ['empty','waiting_order','ordered','waiting_food','ready_clean','cleaning'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`UPDATE tables SET status=? WHERE id=?`).run(status, req.params.id);
  const updated = db.prepare(`SELECT * FROM tables WHERE id=?`).get(req.params.id);
  res.json(updated);
});

module.exports = router;
