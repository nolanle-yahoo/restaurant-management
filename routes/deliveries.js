// Delivery dispatch + driver tracking. A delivery order gets one `deliveries` row
// with its own lifecycle (pending → assigned → picked_up → delivered/failed),
// independent of the kitchen order status. Managers/owners dispatch to a driver;
// the driver advances status and pings location; customers track it live.
const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLog } = require('../lib/audit');
const { broadcast, notify } = require('../lib/ws');

const router = express.Router();
router.use(verifyToken);

// Ensure a deliveries row exists for every delivery order (backfill).
function ensureRows(locId) {
  const cond = locId ? 'AND o.location_id=?' : '';
  const args = locId ? [locId] : [];
  const missing = db.prepare(`SELECT o.id, o.location_id FROM orders o WHERE o.order_type='delivery' AND NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.order_id=o.id) ${cond}`).all(...args);
  const ins = db.prepare(`INSERT OR IGNORE INTO deliveries (order_id, location_id, status) VALUES (?,?,'pending')`);
  missing.forEach(o => ins.run(o.id, o.location_id));
}

// ── Dispatch board (owner/manager) ─────────────────────────
router.get('/', requireRole('owner', 'manager'), (req, res) => {
  const locId = req.user.role === 'owner' ? (req.query.location_id || null) : req.user.location_id;
  ensureRows(locId);
  const cond = locId ? 'WHERE o.location_id=?' : '';
  const args = locId ? [locId] : [];
  const rows = db.prepare(`
    SELECT d.*, o.tracking_code, o.status AS order_status, o.customer_name, o.customer_phone,
           o.delivery_address, o.created_at AS order_created, u.name AS driver_name,
           (SELECT COALESCE(SUM(oi.price*oi.quantity),0) FROM order_items oi WHERE oi.order_id=o.id) AS subtotal
    FROM deliveries d
    JOIN orders o ON d.order_id=o.id
    LEFT JOIN users u ON d.driver_id=u.id
    ${cond}
    ORDER BY (d.status IN ('delivered','failed')), d.created_at DESC
    LIMIT 200
  `).all(...args);
  res.json(rows);
});

// Active drivers to dispatch to (on-duty first).
router.get('/drivers', requireRole('owner', 'manager'), (req, res) => {
  const locId = req.user.role === 'owner' ? (req.query.location_id || null) : req.user.location_id;
  const cond = locId ? 'AND u.location_id=?' : '';
  const args = locId ? [locId] : [];
  const rows = db.prepare(`
    SELECT u.id, u.name, u.location_id,
           EXISTS(SELECT 1 FROM clock_records c WHERE c.user_id=u.id AND c.check_out IS NULL) AS on_duty
    FROM users u
    WHERE u.role='driver' AND u.is_active=1 ${cond}
    ORDER BY on_duty DESC, u.name
  `).all(...args);
  res.json(rows);
});

// Assign (or reassign) a driver to a delivery.
router.post('/:id/assign', requireRole('owner', 'manager'), (req, res) => {
  const d = db.prepare(`SELECT * FROM deliveries WHERE id=?`).get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Delivery not found' });
  if (req.user.role === 'manager' && d.location_id !== req.user.location_id) return res.status(403).json({ error: 'Not your location.' });
  const driver = db.prepare(`SELECT id, name, role, is_active FROM users WHERE id=?`).get(req.body.driver_id);
  if (!driver || driver.role !== 'driver' || !driver.is_active) return res.status(400).json({ error: 'Pick an active driver.' });
  const eta = req.body.eta_minutes != null ? Math.max(0, Math.min(240, parseInt(req.body.eta_minutes) || 0)) : d.eta_minutes;
  db.prepare(`UPDATE deliveries SET driver_id=?, status='assigned', eta_minutes=?, assigned_at=datetime('now') WHERE id=?`).run(driver.id, eta, d.id);
  auditLog(req, 'delivery_assigned', 'delivery', d.id, { driver_id: driver.id, order_id: d.order_id });
  notify(`New delivery assigned to you`, { locId: d.location_id, roles: ['driver'], kind: 'info' });
  broadcast('delivery_update', { id: d.id, order_id: d.order_id, location_id: d.location_id, status: 'assigned' }, d.location_id);
  res.json({ success: true });
});

// ── Driver app ─────────────────────────────────────────────
router.get('/mine', requireRole('driver', 'owner', 'manager'), (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, o.tracking_code, o.customer_name, o.customer_phone, o.delivery_address,
           l.name AS location_name,
           (SELECT COALESCE(SUM(oi.price*oi.quantity),0) FROM order_items oi WHERE oi.order_id=o.id) AS subtotal
    FROM deliveries d
    JOIN orders o ON d.order_id=o.id
    LEFT JOIN locations l ON d.location_id=l.id
    WHERE d.driver_id=? AND d.status IN ('assigned','picked_up')
    ORDER BY d.assigned_at
  `).all(req.user.id);
  res.json(rows);
});

const STEP_TS = { picked_up: 'picked_up_at', delivered: 'delivered_at' };
// Advance a delivery's status (driver for own; owner/manager for their scope).
router.post('/:id/status', requireRole('driver', 'owner', 'manager'), (req, res) => {
  const d = db.prepare(`SELECT * FROM deliveries WHERE id=?`).get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Delivery not found' });
  if (req.user.role === 'driver' && d.driver_id !== req.user.id) return res.status(403).json({ error: 'Not your delivery.' });
  if (req.user.role === 'manager' && d.location_id !== req.user.location_id) return res.status(403).json({ error: 'Not your location.' });
  const status = req.body.status;
  if (!['picked_up', 'delivered', 'failed'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (d.status === 'delivered' || d.status === 'failed') return res.status(409).json({ error: 'This delivery is already closed.' });
  if (status === 'picked_up' && d.status !== 'assigned') return res.status(409).json({ error: 'Delivery must be assigned first.' });

  const tsCol = STEP_TS[status];
  db.prepare(`UPDATE deliveries SET status=?${tsCol ? `, ${tsCol}=datetime('now')` : ''} WHERE id=?`).run(status, d.id);
  // Completing a delivery also closes out the kitchen order.
  if (status === 'delivered') db.prepare(`UPDATE orders SET status='served', updated_at=datetime('now') WHERE id=?`).run(d.order_id);
  auditLog(req, 'delivery_status', 'delivery', d.id, { status, order_id: d.order_id });
  broadcast('delivery_update', { id: d.id, order_id: d.order_id, location_id: d.location_id, status }, d.location_id);
  res.json({ success: true });
});

// Driver location ping (for live customer tracking).
router.post('/:id/location', requireRole('driver'), (req, res) => {
  const d = db.prepare(`SELECT * FROM deliveries WHERE id=?`).get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Delivery not found' });
  if (d.driver_id !== req.user.id) return res.status(403).json({ error: 'Not your delivery.' });
  const lat = parseFloat(req.body.lat), lng = parseFloat(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng required.' });
  db.prepare(`UPDATE deliveries SET driver_lat=?, driver_lng=?, location_updated_at=datetime('now') WHERE id=?`).run(lat, lng, d.id);
  broadcast('delivery_update', { id: d.id, order_id: d.order_id, location_id: d.location_id, status: d.status, moved: true }, d.location_id);
  res.json({ success: true });
});

module.exports = router;
