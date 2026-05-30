const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { broadcast } = require('../lib/ws');
const { auditLog } = require('../lib/audit');

const router = express.Router();
router.use(verifyToken);

router.get('/', requireRole('owner','manager','frontdesk'), (req, res) => {
  const { role, location_id: locId } = req.user;
  const filterLocId = role === 'owner' ? req.query.location_id : locId;
  const date = req.query.date || '';
  const status = req.query.status || '';

  let sql = `
    SELECT r.*, l.name as location_name, t.table_number,
           u.name as created_by_name
    FROM reservations r
    JOIN locations l ON r.location_id=l.id
    LEFT JOIN tables t ON r.table_id=t.id
    LEFT JOIN users u ON r.created_by=u.id
    WHERE 1=1
  `;
  const args = [];
  if (filterLocId) { sql += ' AND r.location_id=?'; args.push(filterLocId); }
  if (date)        { sql += ' AND r.reservation_date=?'; args.push(date); }
  if (status)      { sql += ' AND r.status=?'; args.push(status); }
  sql += ' ORDER BY r.reservation_date, r.reservation_time';

  res.json(db.prepare(sql).all(...args));
});

router.post('/', requireRole('owner','manager','frontdesk'), (req, res) => {
  const { guest_name, guest_phone, guest_email, party_size, reservation_date,
          reservation_time, duration_minutes, table_id, notes, location_id: reqLocId } = req.body;
  if (!guest_name || !reservation_date || !reservation_time || !party_size) {
    return res.status(400).json({ error: 'guest_name, reservation_date, reservation_time and party_size required' });
  }
  const locId = req.user.role === 'owner' ? reqLocId : req.user.location_id;
  if (!locId) return res.status(400).json({ error: 'location_id required' });

  const r = db.prepare(`
    INSERT INTO reservations (location_id, guest_name, guest_phone, guest_email, party_size,
      reservation_date, reservation_time, duration_minutes, table_id, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(locId, guest_name, guest_phone||null, guest_email||null, party_size,
         reservation_date, reservation_time, duration_minutes||90, table_id||null, notes||null, req.user.id);

  auditLog(req, 'reservation_create', 'reservation', r.lastInsertRowid, { guest_name, reservation_date, reservation_time });
  broadcast('reservation_update', { location_id: locId }, locId);
  res.json({ success: true, id: r.lastInsertRowid });
});

router.put('/:id', requireRole('owner','manager','frontdesk'), (req, res) => {
  const existing = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Reservation not found' });

  const { guest_name, guest_phone, guest_email, party_size, reservation_date,
          reservation_time, duration_minutes, table_id, status, notes } = req.body;

  const validStatuses = ['pending','confirmed','seated','completed','no_show','cancelled'];
  if (status && !validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const fields = [`updated_at=datetime('now')`], vals = [];
  if (guest_name !== undefined)       { fields.push('guest_name=?');       vals.push(guest_name); }
  if (guest_phone !== undefined)      { fields.push('guest_phone=?');      vals.push(guest_phone); }
  if (guest_email !== undefined)      { fields.push('guest_email=?');      vals.push(guest_email); }
  if (party_size !== undefined)       { fields.push('party_size=?');       vals.push(party_size); }
  if (reservation_date !== undefined) { fields.push('reservation_date=?'); vals.push(reservation_date); }
  if (reservation_time !== undefined) { fields.push('reservation_time=?'); vals.push(reservation_time); }
  if (duration_minutes !== undefined) { fields.push('duration_minutes=?'); vals.push(duration_minutes); }
  if (table_id !== undefined)         { fields.push('table_id=?');         vals.push(table_id||null); }
  if (status !== undefined)           { fields.push('status=?');           vals.push(status); }
  if (notes !== undefined)            { fields.push('notes=?');            vals.push(notes); }

  vals.push(req.params.id);
  db.prepare(`UPDATE reservations SET ${fields.join(',')} WHERE id=?`).run(...vals);
  auditLog(req, 'reservation_update', 'reservation', req.params.id, { status });
  broadcast('reservation_update', { location_id: existing.location_id }, existing.location_id);
  res.json({ success: true });
});

router.delete('/:id', requireRole('owner','manager'), (req, res) => {
  db.prepare(`DELETE FROM reservations WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
