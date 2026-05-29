const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT * FROM locations ORDER BY name`).all();
  res.json(rows);
});

router.get('/summary', requireRole('owner'), (req, res) => {
  const locations = db.prepare(`SELECT * FROM locations ORDER BY name`).all();

  const summary = locations.map(loc => {
    const staffOnDuty = db.prepare(`SELECT COUNT(*) as cnt FROM clock_records WHERE location_id=? AND check_out IS NULL AND date(check_in)=date('now')`).get(loc.id).cnt;
    const totalTables = db.prepare(`SELECT COUNT(*) as cnt FROM tables WHERE location_id=?`).get(loc.id).cnt;
    const occupiedTables = db.prepare(`SELECT COUNT(*) as cnt FROM tables WHERE location_id=? AND status NOT IN ('empty','ready_clean','cleaning')`).get(loc.id).cnt;
    const openOrders = db.prepare(`SELECT COUNT(*) as cnt FROM orders WHERE location_id=? AND status IN ('pending','preparing')`).get(loc.id).cnt;
    const lowStock = db.prepare(`SELECT COUNT(*) as cnt FROM inventory WHERE location_id=? AND quantity < min_quantity`).get(loc.id).cnt;
    const pendingSupply = db.prepare(`SELECT COUNT(*) as cnt FROM supply_orders WHERE location_id=? AND status='pending'`).get(loc.id).cnt;

    return {
      ...loc,
      staff_on_duty: staffOnDuty,
      total_tables: totalTables,
      occupied_tables: occupiedTables,
      occupancy_pct: totalTables ? Math.round(occupiedTables / totalTables * 100) : 0,
      open_orders: openOrders,
      low_stock_count: lowStock,
      pending_supply_orders: pendingSupply,
    };
  });

  const totals = {
    staff_on_duty: summary.reduce((s, l) => s + l.staff_on_duty, 0),
    open_orders: summary.reduce((s, l) => s + l.open_orders, 0),
    low_stock_count: summary.reduce((s, l) => s + l.low_stock_count, 0),
    pending_supply_orders: summary.reduce((s, l) => s + l.pending_supply_orders, 0),
  };

  res.json({ locations: summary, totals });
});

module.exports = router;
