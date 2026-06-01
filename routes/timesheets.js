const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

// Self-service: the signed-in staff member's own hours, pay, and tips for a
// date range (defaults to the last 7 days). Available to any staff role.
router.get('/me', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const start = req.query.start || weekAgo;
  const end = req.query.end || today;
  const w = db.prepare(`
    SELECT u.hourly_rate,
           round(COALESCE(SUM(c.hours_worked),0), 2) as total_hours,
           round(COALESCE(SUM(c.hours_worked * u.hourly_rate),0), 2) as gross_pay,
           round(COALESCE(SUM(c.hours_worked * u.hourly_rate * 0.85),0), 2) as net_pay
    FROM users u LEFT JOIN clock_records c
      ON c.user_id=u.id AND c.check_out IS NOT NULL
      AND date(c.check_in) >= ? AND date(c.check_in) <= ?
    WHERE u.id=?
  `).get(start, end, req.user.id) || {};
  const tips = (db.prepare(`
    SELECT round(COALESCE(SUM(tip),0), 2) as t FROM payments
    WHERE status='paid' AND waiter_id=? AND date(created_at) >= ? AND date(created_at) <= ?
  `).get(req.user.id, start, end) || {}).t || 0;
  const net = w.net_pay || 0;
  res.json({ start, end, hourly_rate: w.hourly_rate || 0, total_hours: w.total_hours || 0,
             gross_pay: w.gross_pay || 0, net_pay: net, tips, take_home: Math.round((net + tips) * 100) / 100 });
});

router.get('/', requireRole('owner', 'manager'), (req, res) => {
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

  // Summary by employee (wages)
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

  // Tips collected per employee (from paid card/cash payments) in range
  const tipLocCond = locId ? 'AND p.location_id=?' : '';
  const tipRows = db.prepare(`
    SELECT p.waiter_id as user_id, round(SUM(p.tip), 2) as tips
    FROM payments p
    WHERE p.status='paid' AND p.waiter_id IS NOT NULL
      AND date(p.created_at) >= ? AND date(p.created_at) <= ?
      ${tipLocCond}
    GROUP BY p.waiter_id
  `).all(start, end, ...locArgs);
  const tipMap = {};
  tipRows.forEach(t => { tipMap[t.user_id] = t.tips || 0; });

  // Merge tips + take-home (net wages + tips) into each summary row
  summary.forEach(r => {
    r.tips = tipMap[r.user_id] || 0;
    r.take_home = Math.round(((r.net_pay || 0) + r.tips) * 100) / 100;
  });

  const totals = {
    total_hours:     Math.round(summary.reduce((s, r) => s + (r.total_hours   || 0), 0) * 100) / 100,
    total_pay:       Math.round(summary.reduce((s, r) => s + (r.gross_pay     || 0), 0) * 100) / 100,
    total_tax:       Math.round(summary.reduce((s, r) => s + (r.total_tax     || 0), 0) * 100) / 100,
    total_benefit:   Math.round(summary.reduce((s, r) => s + (r.total_benefit || 0), 0) * 100) / 100,
    total_net_pay:   Math.round(summary.reduce((s, r) => s + (r.net_pay       || 0), 0) * 100) / 100,
    total_tips:      Math.round(summary.reduce((s, r) => s + (r.tips          || 0), 0) * 100) / 100,
    total_take_home: Math.round(summary.reduce((s, r) => s + (r.take_home     || 0), 0) * 100) / 100,
  };

  res.json({ records, summary, totals, start, end });
});

module.exports = router;
