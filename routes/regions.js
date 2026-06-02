// Regions, regional managers, and cross-location staff lending.
//
// A region groups locations. A "regional manager" (role 'regional') is scoped to
// one region and can view its locations and lend staff between them. Owners manage
// regions globally and can lend staff anywhere.
const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLog } = require('../lib/audit');

const router = express.Router();
router.use(verifyToken);

const FRONT_ROLES = ['manager','stockroom','employee','frontdesk','waiter','chef'];

function regionLocationIds(regionId) {
  if (!regionId) return [];
  return db.prepare(`SELECT id FROM locations WHERE region_id=?`).all(regionId).map(r => r.id);
}

// Per-location KPI snapshot (mirrors /locations/summary).
function locKpis(loc) {
  const one = sql => db.prepare(sql).get(loc.id).cnt;
  const totalTables = one(`SELECT COUNT(*) cnt FROM tables WHERE location_id=?`);
  const occupied = one(`SELECT COUNT(*) cnt FROM tables WHERE location_id=? AND status NOT IN ('empty','ready_clean','cleaning')`);
  return {
    ...loc,
    staff_on_duty: one(`SELECT COUNT(*) cnt FROM clock_records WHERE location_id=? AND check_out IS NULL AND date(check_in)=date('now')`),
    open_orders: one(`SELECT COUNT(*) cnt FROM orders WHERE location_id=? AND status IN ('pending','preparing')`),
    low_stock_count: one(`SELECT COUNT(*) cnt FROM inventory WHERE location_id=? AND quantity < min_quantity`),
    total_tables: totalTables,
    occupied_tables: occupied,
    occupancy_pct: totalTables ? Math.round(occupied / totalTables * 100) : 0,
  };
}

// ── Region CRUD (owner) ────────────────────────────────────
router.get('/', requireRole('owner'), (req, res) => {
  const regions = db.prepare(`SELECT * FROM regions ORDER BY name`).all();
  const locsByRegion = {};
  db.prepare(`SELECT id, name, region_id FROM locations ORDER BY name`).all().forEach(l => {
    (locsByRegion[l.region_id] = locsByRegion[l.region_id] || []).push({ id: l.id, name: l.name });
  });
  const mgrByRegion = {};
  db.prepare(`SELECT id, name, region_id FROM users WHERE role='regional' AND is_active=1`).all().forEach(u => {
    (mgrByRegion[u.region_id] = mgrByRegion[u.region_id] || []).push({ id: u.id, name: u.name });
  });
  res.json(regions.map(r => ({ ...r, locations: locsByRegion[r.id] || [], managers: mgrByRegion[r.id] || [] })));
});

router.post('/', requireRole('owner'), (req, res) => {
  const name = (req.body.name || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'Region name required.' });
  const r = db.prepare(`INSERT INTO regions (name) VALUES (?)`).run(name.slice(0, 80));
  auditLog(req, 'region_create', 'region', r.lastInsertRowid, { name });
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/:id', requireRole('owner'), (req, res) => {
  const name = (req.body.name || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'Region name required.' });
  const reg = db.prepare(`SELECT id FROM regions WHERE id=?`).get(req.params.id);
  if (!reg) return res.status(404).json({ error: 'Region not found.' });
  db.prepare(`UPDATE regions SET name=? WHERE id=?`).run(name.slice(0, 80), req.params.id);
  res.json({ success: true });
});

router.delete('/:id', requireRole('owner'), (req, res) => {
  const reg = db.prepare(`SELECT id FROM regions WHERE id=?`).get(req.params.id);
  if (!reg) return res.status(404).json({ error: 'Region not found.' });
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE locations SET region_id=NULL WHERE region_id=?`).run(req.params.id);
    // Demote any regional managers of this region back to plain managers.
    db.prepare(`UPDATE users SET role='manager', region_id=NULL, token_version=token_version+1 WHERE role='regional' AND region_id=?`).run(req.params.id);
    db.prepare(`DELETE FROM regions WHERE id=?`).run(req.params.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  auditLog(req, 'region_delete', 'region', Number(req.params.id), {});
  res.json({ success: true });
});

// Assign (or clear) a location's region.
router.put('/assign-location', requireRole('owner'), (req, res) => {
  const { location_id, region_id } = req.body;
  const loc = db.prepare(`SELECT id FROM locations WHERE id=?`).get(location_id);
  if (!loc) return res.status(404).json({ error: 'Location not found.' });
  if (region_id && !db.prepare(`SELECT id FROM regions WHERE id=?`).get(region_id)) return res.status(404).json({ error: 'Region not found.' });
  db.prepare(`UPDATE locations SET region_id=? WHERE id=?`).run(region_id || null, location_id);
  auditLog(req, 'region_assign_location', 'location', location_id, { region_id: region_id || null });
  res.json({ success: true });
});

// Promote a manager to regional manager of a region (or, with region_id null, demote).
router.post('/assign-manager', requireRole('owner'), (req, res) => {
  const { user_id, region_id } = req.body;
  const u = db.prepare(`SELECT id, role FROM users WHERE id=? AND is_active=1`).get(user_id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (u.role === 'owner') return res.status(400).json({ error: 'Owners cannot be regional managers.' });
  if (region_id) {
    if (!db.prepare(`SELECT id FROM regions WHERE id=?`).get(region_id)) return res.status(404).json({ error: 'Region not found.' });
    // Bumping token_version forces a fresh login so the new role takes effect.
    db.prepare(`UPDATE users SET role='regional', region_id=?, token_version=token_version+1 WHERE id=?`).run(region_id, user_id);
    auditLog(req, 'regional_manager_assigned', 'user', user_id, { region_id });
  } else {
    db.prepare(`UPDATE users SET role='manager', region_id=NULL, token_version=token_version+1 WHERE id=?`).run(user_id);
    auditLog(req, 'regional_manager_removed', 'user', user_id, {});
  }
  res.json({ success: true });
});

// ── Regional overview ──────────────────────────────────────
// The regional manager's own region (owner may pass ?region_id).
router.get('/mine', requireRole('owner', 'regional'), (req, res) => {
  const regionId = req.user.role === 'regional' ? req.user.region_id : (req.query.region_id || null);
  if (!regionId) return res.status(400).json({ error: 'No region assigned.' });
  const region = db.prepare(`SELECT * FROM regions WHERE id=?`).get(regionId);
  if (!region) return res.status(404).json({ error: 'Region not found.' });
  const locs = db.prepare(`SELECT * FROM locations WHERE region_id=? ORDER BY name`).all(regionId).map(locKpis);
  const ids = locs.map(l => l.id);
  const staff = ids.length ? db.prepare(`
    SELECT u.id, u.name, u.role, u.location_id, u.home_location_id, l.name AS location_name
    FROM users u LEFT JOIN locations l ON u.location_id=l.id
    WHERE u.is_active=1 AND u.role!='owner' AND u.location_id IN (${ids.map(()=>'?').join(',')})
    ORDER BY l.name, u.name
  `).all(...ids) : [];
  res.json({ region, locations: locs, staff });
});

// ── Cross-location staff lending ───────────────────────────
router.get('/loans', requireRole('owner', 'regional'), (req, res) => {
  let cond = '', args = [];
  if (req.user.role === 'regional') {
    const ids = regionLocationIds(req.user.region_id);
    if (!ids.length) return res.json([]);
    const ph = ids.map(() => '?').join(',');
    cond = `WHERE (sl.from_location_id IN (${ph}) OR sl.to_location_id IN (${ph}))`;
    args = [...ids, ...ids];
  }
  const rows = db.prepare(`
    SELECT sl.*, u.name AS user_name, u.role AS user_role,
           lf.name AS from_location_name, lt.name AS to_location_name, c.name AS created_by_name
    FROM staff_loans sl
    JOIN users u ON sl.user_id=u.id
    LEFT JOIN locations lf ON sl.from_location_id=lf.id
    LEFT JOIN locations lt ON sl.to_location_id=lt.id
    LEFT JOIN users c ON sl.created_by=c.id
    ${cond}
    ORDER BY sl.status='active' DESC, sl.created_at DESC LIMIT 100
  `).all(...args);
  res.json(rows);
});

router.post('/lend', requireRole('owner', 'regional'), (req, res) => {
  const { user_id, to_location_id, note } = req.body;
  const u = db.prepare(`SELECT id, role, location_id, home_location_id, is_active FROM users WHERE id=?`).get(user_id);
  if (!u || !u.is_active) return res.status(404).json({ error: 'Staff member not found.' });
  if (u.role === 'owner' || u.role === 'regional') return res.status(400).json({ error: 'Only floor/store staff can be lent.' });
  const dest = db.prepare(`SELECT id FROM locations WHERE id=?`).get(to_location_id);
  if (!dest) return res.status(404).json({ error: 'Destination location not found.' });
  if (u.location_id === to_location_id) return res.status(400).json({ error: 'Staff member is already at that location.' });
  const active = db.prepare(`SELECT id FROM staff_loans WHERE user_id=? AND status='active'`).get(user_id);
  if (active) return res.status(409).json({ error: 'This staff member is already on loan. Return them first.' });

  if (req.user.role === 'regional') {
    const ids = regionLocationIds(req.user.region_id);
    if (!ids.includes(u.location_id) || !ids.includes(to_location_id)) {
      return res.status(403).json({ error: 'You can only lend staff between locations in your region.' });
    }
  }

  const from = u.location_id;
  const home = u.home_location_id || from;
  db.exec('BEGIN');
  try {
    if (!u.home_location_id) db.prepare(`UPDATE users SET home_location_id=? WHERE id=?`).run(home, user_id);
    db.prepare(`INSERT INTO staff_loans (user_id, from_location_id, to_location_id, note, created_by) VALUES (?,?,?,?,?)`)
      .run(user_id, from, to_location_id, (note || '').toString().slice(0, 200) || null, req.user.id);
    db.prepare(`UPDATE users SET location_id=? WHERE id=?`).run(to_location_id, user_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  auditLog(req, 'staff_lent', 'user', user_id, { from, to: to_location_id });
  res.json({ success: true });
});

router.post('/loans/:id/return', requireRole('owner', 'regional'), (req, res) => {
  const loan = db.prepare(`SELECT * FROM staff_loans WHERE id=?`).get(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found.' });
  if (loan.status !== 'active') return res.status(409).json({ error: 'This loan is already closed.' });
  if (req.user.role === 'regional') {
    const ids = regionLocationIds(req.user.region_id);
    if (!ids.includes(loan.from_location_id) && !ids.includes(loan.to_location_id)) {
      return res.status(403).json({ error: 'Not in your region.' });
    }
  }
  const u = db.prepare(`SELECT home_location_id FROM users WHERE id=?`).get(loan.user_id);
  const back = (u && u.home_location_id) || loan.from_location_id;
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE users SET location_id=? WHERE id=?`).run(back, loan.user_id);
    db.prepare(`UPDATE staff_loans SET status='returned', returned_at=datetime('now') WHERE id=?`).run(loan.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  auditLog(req, 'staff_returned', 'user', loan.user_id, { to: back });
  res.json({ success: true });
});

module.exports = router;
