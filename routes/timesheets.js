const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);
router.use(requireRole('owner', 'manager'));

router.get('/', (req, res) => {
  const locId = req.user.role === 'owner' ? req.query.location_id : req.user.location_id;
  const start = req.query.start;
  const end   = req.query.end;

  if (!start || !end) return res.status(400).json({ error: 'start and end date required (YYYY-MM-DD)' });

  const locCond  = locId ? 'AND u.location_id=?' : '';
  const locArgs  = locId ? [locId] : [];

  // Detail records
  const records = db.prepare(`
    SELECT c.id, c.user_id, date(c.check_in) as work_date,
           time(c.check_in) as clock_in_time, time(c.check_out) as clock_out_time,
           c.hours_worked,
           u.name, u.role, u.hourly_rate, u.location_id,
           l.name as location_name,
           round(c.hours_worked * u.hourly_rate, 2) as gross_pay,
           round(c.hours_worked * u.hourly_rate * 0.10, 2) as tax_amount,
           round(c.hours_worked * u.hourly_rate * 0.05, 2) as benefit_amount,
           round(c.hours_worked * u.hourly_rate * 0.85, 2) as net_pay
    FROM clock_records c
    JOIN users u ON c.user_id=u.id
    LEFT JOIN locations l ON u.location_id=l.id
    WHERE c.check_out IS NOT NULL
      AND date(c.check_in) >= ? AND date(c.check_in) <= ?
      ${locCond}
    ORDER BY date(c.check_in) DESC, u.name
  `).all(start, end, ...locArgs);

  // Summary by employee
  const summary = db.prepare(`
    SELECT u.id as user_id, u.name, u.role, u.hourly_rate,
           l.name as location_name,
           round(SUM(c.hours_worked), 2) as total_hours,
           round(SUM(c.hours_worked * u.hourly_rate), 2) as gross_pay,
           round(SUM(c.hours_worked * u.hourly_rate * 0.10), 2) as total_tax,
           round(SUM(c.hours_worked * u.hourly_rate * 0.05), 2) as total_benefit,
           round(SUM(c.hours_worked * u.hourly_rate * 0.85), 2) as net_pay
    FROM clock_records c
    JOIN users u ON c.user_id=u.id
    LEFT JOIN locations l ON u.location_id=l.id
    WHERE c.check_out IS NOT NULL
      AND date(c.check_in) >= ? AND date(c.check_in) <= ?
      ${locCond}
    GROUP BY u.id
    ORDER BY u.name
  `).all(start, end, ...locArgs);

  const totals = {
    total_hours:   Math.round(summary.reduce((s, r) => s + (r.total_hours || 0), 0) * 100) / 100,
    total_pay:     Math.round(summary.reduce((s, r) => s + (r.gross_pay   || 0), 0) * 100) / 100,
    total_tax:     Math.round(summary.reduce((s, r) => s + (r.total_tax   || 0), 0) * 100) / 100,
    total_benefit: Math.round(summary.reduce((s, r) => s + (r.total_benefit || 0), 0) * 100) / 100,
    total_net_pay: Math.round(summary.reduce((s, r) => s + (r.net_pay     || 0), 0) * 100) / 100,
  };

  res.json({ records, summary, totals, start, end });
});

module.exports = router;
