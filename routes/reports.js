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
