// End-of-day reporting: a Z-report (daily sales close) and cash-drawer reconciliation
// (open with a float → pay-ins/outs → count & close with over/short + deposit).
const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLog } = require('../lib/audit');

const router = express.Router();
router.use(verifyToken);
router.use(requireRole('owner', 'manager'));

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
// Managers are pinned to their own location; owners may pass ?location_id.
const scopeLoc = req => (req.user.role === 'owner' ? (req.query.location_id || req.body.location_id || null) : req.user.location_id);

// ── Z-report: a single business day's sales close for one location ──────────────
router.get('/zreport', (req, res) => {
  const locId = scopeLoc(req);
  if (!locId) return res.status(400).json({ error: 'A location is required for the Z-report.' });
  const date = (req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);

  const loc = db.prepare(`SELECT name FROM locations WHERE id=?`).get(locId);
  const paidWhere = `WHERE p.location_id=? AND p.status='paid' AND date(p.created_at)=date(?)`;
  const args = [locId, date];

  const totals = db.prepare(`
    SELECT COUNT(*) AS orders,
           COALESCE(SUM(p.subtotal),0)        AS gross_sales,
           COALESCE(SUM(p.discount+p.manual_discount),0) AS discounts,
           COALESCE(SUM(p.manual_discount),0) AS comps,
           COALESCE(SUM(p.service_charge),0)  AS service_charge,
           COALESCE(SUM(p.tax),0)             AS tax,
           COALESCE(SUM(p.tip),0)             AS tips,
           COALESCE(SUM(p.total),0)           AS total_collected
    FROM payments p ${paidWhere}
  `).get(...args);
  const net_sales = round2(totals.gross_sales - totals.discounts);

  const byMethod = db.prepare(`
    SELECT p.method, COUNT(*) AS n, COALESCE(SUM(p.total),0) AS total, COALESCE(SUM(p.tip),0) AS tips
    FROM payments p ${paidWhere} GROUP BY p.method
  `).all(...args);

  const refunds = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(p.total),0) AS total
    FROM payments p WHERE p.location_id=? AND p.status='refunded' AND date(p.created_at)=date(?)
  `).get(...args);

  const voids = db.prepare(`
    SELECT COUNT(*) AS n FROM orders o WHERE o.location_id=? AND o.voided=1 AND date(o.updated_at)=date(?)
  `).get(...args);

  const compCount = db.prepare(`
    SELECT COUNT(*) AS n FROM payments p ${paidWhere} AND p.manual_discount>0
  `).get(...args).n;

  res.json({
    location_id: Number(locId), location_name: loc ? loc.name : '—', date,
    orders: totals.orders,
    gross_sales: round2(totals.gross_sales),
    discounts: round2(totals.discounts),
    comps: round2(totals.comps), comp_count: compCount,
    net_sales,
    service_charge: round2(totals.service_charge),
    tax: round2(totals.tax),
    tips: round2(totals.tips),
    total_collected: round2(totals.total_collected),
    avg_check: totals.orders ? round2(net_sales / totals.orders) : 0,
    by_method: byMethod.map(m => ({ method: m.method, count: m.n, total: round2(m.total), tips: round2(m.tips) })),
    refunds: { count: refunds.n, total: round2(refunds.total) },
    voids: voids.n,
  });
});

// ── Live labor: who's on the clock, labor % vs sales, overtime alerts ───────────
const WEEK_OT = 40, WEEK_APPROACHING = 36, LONG_SHIFT_HOURS = 8;
const _ms = s => new Date(s.replace(' ', 'T') + 'Z').getTime();

router.get('/labor', (req, res) => {
  const locId = scopeLoc(req);
  if (!locId) return res.status(400).json({ error: 'A location is required for the labor report.' });
  const date = (req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const now = Date.now();
  const hoursOf = (ci, co) => Math.max(0, ((co ? _ms(co) : now) - _ms(ci)) / 3.6e6);

  // Clock records active today (started today) or still open (overnight shift).
  const today = db.prepare(`
    SELECT cr.user_id, cr.check_in, cr.check_out, cr.hours_worked, u.name, u.role, u.hourly_rate
    FROM clock_records cr JOIN users u ON cr.user_id=u.id
    WHERE cr.location_id=? AND (date(cr.check_in)=date(?) OR cr.check_out IS NULL)
  `).all(locId, date);

  let laborCost = 0, laborHours = 0;
  today.forEach(r => {
    const h = r.check_out != null ? (r.hours_worked != null ? r.hours_worked : hoursOf(r.check_in, r.check_out)) : hoursOf(r.check_in, null);
    r._h = Math.max(0, h);
    laborCost += r._h * (r.hourly_rate || 0);
    laborHours += r._h;
  });
  laborCost = round2(laborCost);
  laborHours = Math.round(laborHours * 100) / 100;

  // Hours so far this work-week (from Monday 00:00 UTC) per user, for overtime flags.
  const d = new Date();
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  const wkStart = monday.toISOString().slice(0, 10) + ' 00:00:00';
  const weekByUser = {};
  db.prepare(`SELECT user_id, check_in, check_out, hours_worked FROM clock_records WHERE location_id=? AND check_in>=?`)
    .all(locId, wkStart)
    .forEach(r => {
      const h = r.check_out != null ? (r.hours_worked != null ? r.hours_worked : hoursOf(r.check_in, r.check_out)) : hoursOf(r.check_in, null);
      weekByUser[r.user_id] = (weekByUser[r.user_id] || 0) + Math.max(0, h);
    });

  const on_duty = today.filter(r => r.check_out == null).map(r => {
    const shift_hours = hoursOf(r.check_in, null);
    const week_hours = Math.round((weekByUser[r.user_id] || shift_hours) * 100) / 100;
    const ot_status = week_hours >= WEEK_OT ? 'overtime' : week_hours >= WEEK_APPROACHING ? 'approaching' : 'none';
    return {
      user_id: r.user_id, name: r.name, role: r.role, hourly_rate: r.hourly_rate, check_in: r.check_in,
      shift_hours: Math.round(shift_hours * 100) / 100, hours_today: Math.round(r._h * 100) / 100,
      week_hours, labor_cost: round2(r._h * (r.hourly_rate || 0)),
      ot_status, long_shift: shift_hours > LONG_SHIFT_HOURS,
    };
  }).sort((a, b) => b.week_hours - a.week_hours);

  // Net sales today (food/bev, ex tax/tip) at the location — the labor-% denominator.
  const salesNet = round2(db.prepare(`
    SELECT COALESCE(SUM(subtotal - discount - manual_discount),0) s
    FROM payments WHERE location_id=? AND status='paid' AND date(created_at)=date(?)
  `).get(locId, date).s);

  res.json({
    location_id: Number(locId), date,
    on_duty, headcount: on_duty.length,
    labor_cost_today: laborCost, labor_hours_today: laborHours,
    sales_today: salesNet,
    labor_pct: salesNet > 0 ? Math.round((laborCost / salesNet * 100) * 10) / 10 : null,
    sales_per_labor_hour: laborHours > 0 ? round2(salesNet / laborHours) : null,
    ot_count: on_duty.filter(d => d.ot_status !== 'none').length,
    long_shift_count: on_duty.filter(d => d.long_shift).length,
    thresholds: { week_ot: WEEK_OT, week_approaching: WEEK_APPROACHING, long_shift: LONG_SHIFT_HOURS },
  });
});

// ── Cash drawer ─────────────────────────────────────────────────────────────────
// Cash sales captured by an open drawer = paid cash payments at its location from
// open time until now (or its close time).
function cashSalesFor(drawer) {
  const end = drawer.closed_at || new Date().toISOString().replace('T', ' ').slice(0, 19);
  return round2(db.prepare(`
    SELECT COALESCE(SUM(total),0) s FROM payments
    WHERE location_id=? AND status='paid' AND method='cash'
      AND created_at >= ? AND created_at <= ?
  `).get(drawer.location_id, drawer.opened_at, end).s);
}
function eventTotals(drawerId) {
  const rows = db.prepare(`SELECT type, COALESCE(SUM(amount),0) s FROM cash_events WHERE drawer_id=? GROUP BY type`).all(drawerId);
  const m = { paid_in: 0, paid_out: 0 };
  rows.forEach(r => { m[r.type] = round2(r.s); });
  return m;
}
function drawerView(d) {
  const cash_sales = cashSalesFor(d);
  const ev = eventTotals(d.id);
  const expected = round2(d.opening_float + cash_sales + ev.paid_in - ev.paid_out);
  return {
    ...d, cash_sales, paid_in: ev.paid_in, paid_out: ev.paid_out, expected_cash_live: expected,
    events: db.prepare(`SELECT id, type, amount, reason, user_name, created_at FROM cash_events WHERE drawer_id=? ORDER BY id`).all(d.id),
  };
}

// The currently open drawer at the location (or null).
router.get('/cash/current', (req, res) => {
  const locId = scopeLoc(req);
  if (!locId) return res.json(null);
  const d = db.prepare(`SELECT * FROM cash_drawers WHERE location_id=? AND status='open' ORDER BY id DESC LIMIT 1`).get(locId);
  res.json(d ? drawerView(d) : null);
});

// Recent closed drawers.
router.get('/cash/history', (req, res) => {
  const locId = scopeLoc(req);
  if (!locId) return res.json([]);
  res.json(db.prepare(`SELECT * FROM cash_drawers WHERE location_id=? AND status='closed' ORDER BY id DESC LIMIT 30`).all(locId));
});

// Open a drawer with a starting float (one open drawer per location).
router.post('/cash/open', (req, res) => {
  const locId = scopeLoc(req);
  if (!locId) return res.status(400).json({ error: 'A location is required.' });
  const float = round2(req.body.opening_float);
  if (!(float >= 0)) return res.status(400).json({ error: 'Enter a valid opening float.' });
  if (db.prepare(`SELECT id FROM cash_drawers WHERE location_id=? AND status='open'`).get(locId)) {
    return res.status(409).json({ error: 'A drawer is already open for this location. Close it first.' });
  }
  const r = db.prepare(`INSERT INTO cash_drawers (location_id, opened_by, opened_by_name, opening_float) VALUES (?,?,?,?)`)
    .run(locId, req.user.id, req.user.name, float);
  auditLog(req, 'cash_drawer_open', 'cash_drawer', r.lastInsertRowid, { opening_float: float, location_id: Number(locId) });
  res.json({ success: true, id: r.lastInsertRowid });
});

// Record a pay-in or pay-out against the open drawer.
router.post('/cash/:id/event', (req, res) => {
  const d = db.prepare(`SELECT * FROM cash_drawers WHERE id=?`).get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Drawer not found' });
  if (d.status !== 'open') return res.status(400).json({ error: 'That drawer is closed.' });
  if (req.user.role === 'manager' && d.location_id !== req.user.location_id) return res.status(403).json({ error: 'That drawer is at another location.' });
  const type = req.body.type === 'paid_out' ? 'paid_out' : 'paid_in';
  const amount = round2(req.body.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount greater than zero.' });
  const reason = (req.body.reason || '').toString().slice(0, 200) || null;
  db.prepare(`INSERT INTO cash_events (drawer_id, type, amount, reason, user_id, user_name) VALUES (?,?,?,?,?,?)`)
    .run(d.id, type, amount, reason, req.user.id, req.user.name);
  auditLog(req, 'cash_' + type, 'cash_drawer', d.id, { amount, reason });
  res.json({ success: true });
});

// Close the drawer: count it, compute over/short, record a deposit.
router.post('/cash/:id/close', (req, res) => {
  const d = db.prepare(`SELECT * FROM cash_drawers WHERE id=?`).get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Drawer not found' });
  if (d.status !== 'open') return res.status(400).json({ error: 'That drawer is already closed.' });
  if (req.user.role === 'manager' && d.location_id !== req.user.location_id) return res.status(403).json({ error: 'That drawer is at another location.' });
  const closing = round2(req.body.closing_count);
  if (!(closing >= 0)) return res.status(400).json({ error: 'Enter the counted cash amount.' });
  const deposit = req.body.deposit_amount != null ? round2(req.body.deposit_amount) : null;
  const ev = eventTotals(d.id);
  const cash_sales = cashSalesFor({ ...d, closed_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  const expected = round2(d.opening_float + cash_sales + ev.paid_in - ev.paid_out);
  const over_short = round2(closing - expected);
  db.prepare(`
    UPDATE cash_drawers SET status='closed', closed_by=?, closed_by_name=?, closing_count=?,
      expected_cash=?, over_short=?, deposit_amount=?, notes=?, closed_at=datetime('now') WHERE id=?
  `).run(req.user.id, req.user.name, closing, expected, over_short, deposit,
         (req.body.notes || '').toString().slice(0, 300) || null, d.id);
  auditLog(req, 'cash_drawer_close', 'cash_drawer', d.id, { expected, counted: closing, over_short, deposit });
  res.json({ success: true, expected_cash: expected, over_short, cash_sales });
});

module.exports = router;
