const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);
router.use(requireRole('owner', 'manager'));

// Resolve the location scope: owner may pass ?location_id (or none = all);
// managers are always pinned to their own location.
function scope(req) {
  if (req.user.role === 'owner') return req.query.location_id || null;
  return req.user.location_id;
}

// Sales analytics over a date range (defaults to last 30 days).
router.get('/', (req, res) => {
  const locId = scope(req);
  const end   = req.query.end   || new Date().toISOString().slice(0, 10);
  const start = req.query.start || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);

  const locCond = locId ? 'AND p.location_id = ?' : '';
  const baseArgs = [start, end, ...(locId ? [locId] : [])];

  const where = `WHERE p.status='paid' AND date(p.created_at) >= ? AND date(p.created_at) <= ? ${locCond}`;

  // Headline KPIs
  const kpis = db.prepare(`
    SELECT
      COUNT(*)                    AS orders_paid,
      COALESCE(SUM(p.subtotal),0) AS subtotal,
      COALESCE(SUM(p.tax),0)      AS tax,
      COALESCE(SUM(p.tip),0)      AS tips,
      COALESCE(SUM(p.total),0)    AS revenue
    FROM payments p ${where}
  `).get(...baseArgs);
  kpis.avg_ticket = kpis.orders_paid ? Math.round((kpis.revenue / kpis.orders_paid) * 100) / 100 : 0;

  // Revenue per calendar day (for the trend chart)
  const byDay = db.prepare(`
    SELECT date(p.created_at) AS day,
           COUNT(*) AS orders,
           ROUND(SUM(p.total),2) AS revenue
    FROM payments p ${where}
    GROUP BY date(p.created_at)
    ORDER BY day
  `).all(...baseArgs);

  // Payment method split
  const byMethod = db.prepare(`
    SELECT p.method, COUNT(*) AS count, ROUND(SUM(p.total),2) AS revenue
    FROM payments p ${where}
    GROUP BY p.method
    ORDER BY revenue DESC
  `).all(...baseArgs);

  // Best-selling menu items (joins paid payments → orders → order_items)
  const itemLocCond = locId ? 'AND o.location_id = ?' : '';
  const topItems = db.prepare(`
    SELECT oi.item_name,
           SUM(oi.quantity) AS qty,
           ROUND(SUM(oi.quantity * oi.price),2) AS revenue
    FROM payments p
    JOIN orders o      ON p.order_id = o.id
    JOIN order_items oi ON oi.order_id = o.id
    WHERE p.status='paid' AND date(p.created_at) >= ? AND date(p.created_at) <= ? ${itemLocCond}
    GROUP BY oi.item_name
    ORDER BY revenue DESC
    LIMIT 10
  `).all(start, end, ...(locId ? [locId] : []));

  // Revenue by location (owner, all-locations view only)
  let byLocation = [];
  if (!locId) {
    byLocation = db.prepare(`
      SELECT l.id, l.name,
             COUNT(p.id) AS orders,
             ROUND(SUM(p.total),2) AS revenue
      FROM payments p
      JOIN locations l ON p.location_id = l.id
      WHERE p.status='paid' AND date(p.created_at) >= ? AND date(p.created_at) <= ?
      GROUP BY l.id
      ORDER BY revenue DESC
    `).all(start, end);
  }

  res.json({ start, end, location_id: locId, kpis, by_day: byDay, by_method: byMethod, top_items: topItems, by_location: byLocation });
});

// Per-employee performance (the server who settled each paid order).
router.get('/staff', (req, res) => {
  const locId = scope(req);
  const end   = req.query.end   || new Date().toISOString().slice(0, 10);
  const start = req.query.start || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const locCond = locId ? 'AND p.location_id = ?' : '';
  const args = [start, end, ...(locId ? [locId] : [])];
  const rows = db.prepare(`
    SELECT u.id, u.name, u.role,
           COUNT(*)                       AS orders,
           ROUND(SUM(p.subtotal),2)       AS sales,
           ROUND(SUM(p.tip),2)            AS tips,
           ROUND(SUM(p.total),2)          AS revenue,
           ROUND(AVG(p.total),2)          AS avg_ticket
    FROM payments p
    JOIN users u ON p.waiter_id = u.id
    WHERE p.status='paid' AND p.waiter_id IS NOT NULL
      AND date(p.created_at) >= ? AND date(p.created_at) <= ? ${locCond}
    GROUP BY u.id
    ORDER BY revenue DESC
  `).all(...args);
  res.json({ start, end, staff: rows });
});

module.exports = router;
