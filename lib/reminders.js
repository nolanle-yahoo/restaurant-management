// Reservation reminders: a lightweight in-process timer that notifies front
// desk / managers of confirmed reservations starting soon. Each reservation is
// reminded once (tracked by the `reminded` flag). Times are treated as local.

const db = require('../db/database');
const { notify } = require('./ws');

const WINDOW_MIN = 30; // remind when a reservation starts within this many minutes

function checkOnce() {
  try {
    const today = new Date();
    const ymd = today.toISOString().slice(0, 10);
    const rows = db.prepare(`
      SELECT id, location_id, guest_name, party_size, reservation_time
      FROM reservations
      WHERE status='confirmed' AND reminded=0 AND reservation_date=?
    `).all(ymd);

    rows.forEach(r => {
      const start = new Date(`${ymd}T${(r.reservation_time || '00:00')}:00`);
      const diffMin = (start - new Date()) / 60000;
      if (diffMin >= 0 && diffMin <= WINDOW_MIN) {
        notify(`Upcoming reservation: ${r.guest_name} (party of ${r.party_size}) at ${r.reservation_time}`,
          { locId: r.location_id, roles: ['frontdesk', 'manager'], kind: 'reservation' });
        db.prepare(`UPDATE reservations SET reminded=1 WHERE id=?`).run(r.id);
      }
    });
  } catch (e) {
    console.error('reservation reminder check failed:', e.message);
  }
}

function start() {
  setInterval(checkOnce, 60 * 1000).unref?.();
}

module.exports = { start };
