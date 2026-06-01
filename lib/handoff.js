// Task hand-off on clock-out.
//
// When a staff member clocks out, their unfinished work must not be abandoned:
//   • Open orders (not yet paid) and their area assignments are reassigned to the
//     least-loaded on-duty colleague at the same location.
//   • If nobody else is on duty, the orders stay assigned (so tip/payroll
//     attribution is preserved) and the owner is alerted to arrange coverage.
//
// Runs synchronously inside the clock-out request and never throws into it.

const db = require('../db/database');
const { broadcast } = require('./ws');
const { auditLog } = require('./audit');
const { sendEmail } = require('./email');

// Roles that can hold a table/order (front-of-house). Owner is excluded — they
// never clock in and shouldn't be handed floor work.
const COVER_ROLES = ['waiter', 'employee', 'manager', 'frontdesk'];

// Orders still needing service/settlement: belong to the user, at the location,
// with no successful payment yet.
const OPEN_ORDERS_SQL = `
  o.waiter_id = ? AND o.location_id = ?
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'paid')
`;

function handoffOnClockOut(req, userId, locationId) {
  try {
    if (!locationId) return { tasks: 0, reassigned: false, notifiedOwner: false };

    const openOrders = db.prepare(`
      SELECT o.id, t.table_number
      FROM orders o JOIN tables t ON o.table_id = t.id
      WHERE ${OPEN_ORDERS_SQL}
    `).all(userId, locationId);

    const areaRows = db.prepare(`
      SELECT wa.id, wa.area_id
      FROM waiter_assignments wa JOIN areas a ON wa.area_id = a.id
      WHERE wa.user_id = ? AND a.location_id = ?
    `).all(userId, locationId);

    const taskCount = openOrders.length + areaRows.length;
    if (taskCount === 0) return { tasks: 0, reassigned: false, notifiedOwner: false };

    // Least-loaded on-duty colleague (fewest open orders), excluding this user.
    const colleague = db.prepare(`
      SELECT u.id, u.name,
             (SELECT COUNT(*) FROM orders o
              WHERE o.waiter_id = u.id AND o.location_id = ?
                AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'paid')
             ) AS load
      FROM users u
      JOIN clock_records c ON c.user_id = u.id AND c.check_out IS NULL
      WHERE u.location_id = ? AND u.is_active = 1 AND u.id != ?
        AND u.role IN (${COVER_ROLES.map(() => '?').join(',')})
      ORDER BY load ASC, u.id ASC
      LIMIT 1
    `).get(locationId, locationId, userId, ...COVER_ROLES);

    if (colleague) {
      // Reassign open orders.
      db.prepare(`
        UPDATE orders SET waiter_id = ?, updated_at = datetime('now')
        WHERE waiter_id = ? AND location_id = ?
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id AND p.status = 'paid')
      `).run(colleague.id, userId, locationId);

      // Move area assignments, honouring the UNIQUE(user_id, area_id) constraint.
      const already = db.prepare(`SELECT 1 FROM waiter_assignments WHERE user_id = ? AND area_id = ?`);
      const moveOne = db.prepare(`UPDATE waiter_assignments SET user_id = ? WHERE id = ?`);
      const dropOne = db.prepare(`DELETE FROM waiter_assignments WHERE id = ?`);
      areaRows.forEach(a => {
        if (already.get(colleague.id, a.area_id)) dropOne.run(a.id);
        else moveOne.run(colleague.id, a.id);
      });

      if (openOrders.length) {
        broadcast('order_update', { type: 'reassign', location_id: locationId }, locationId);
      }
      auditLog(req, 'tasks_reassigned', 'user', userId,
        { to: colleague.name, to_id: colleague.id, orders: openOrders.length, areas: areaRows.length });

      return { tasks: taskCount, reassigned: true, to: colleague.name, orders: openOrders.length };
    }

    // Nobody on duty: keep orders assigned (preserve attribution), drop the
    // departing user's area assignments, and alert the owner.
    if (areaRows.length) {
      db.prepare(`DELETE FROM waiter_assignments WHERE user_id = ? AND area_id IN (
        SELECT id FROM areas WHERE location_id = ?
      )`).run(userId, locationId);
    }

    const me = db.prepare(`SELECT name FROM users WHERE id = ?`).get(userId) || {};
    const locName = (db.prepare(`SELECT name FROM locations WHERE id = ?`).get(locationId) || {}).name || 'the location';
    const tables = openOrders.map(o => `Table ${o.table_number}`).join(', ') || 'none';
    const subject = `Coverage needed — ${me.name || 'A staff member'} clocked out`;
    const body =
      `${me.name || 'A staff member'} clocked out at ${locName} with ${openOrders.length} open order(s) ` +
      `and no other staff currently on duty to take over.\n\n` +
      `Tables still needing service/settlement: ${tables}.\n\n` +
      `These orders remain assigned to ${me.name || 'them'} for now — please arrange coverage.`;

    db.prepare(`
      INSERT INTO employee_messages (user_id, location_id, recipient_type, subject, message)
      VALUES (?,?,'owner',?,?)
    `).run(userId, locationId, subject, body);

    db.prepare(`SELECT email FROM users WHERE role = 'owner' AND is_active = 1 AND email IS NOT NULL`)
      .all()
      .forEach(o => sendEmail(o.email, subject, body, 'coverage'));

    auditLog(req, 'clockout_no_coverage', 'user', userId, { orders: openOrders.length, areas: areaRows.length });

    return { tasks: taskCount, reassigned: false, notifiedOwner: true, orders: openOrders.length };
  } catch (e) {
    console.error('handoffOnClockOut failed:', e.message);
    return { tasks: 0, reassigned: false, notifiedOwner: false, error: true };
  }
}

module.exports = { handoffOnClockOut };
