// KDS course-firing helpers. Kitchen tickets group items into courses; a course is
// "fired" (sent to the line) by stamping fired_at on its items. Dine-in orders hold
// later courses for pacing; to-go orders fire everything at once. Prep timers on the
// KDS count up from fired_at against a per-item target (prep_minutes), falling back to
// a sensible per-course default.
const db = require('../db/database');

const COURSE_ORDER = ['Appetizers', 'Mains', 'Desserts', 'Drinks'];

// Default cook-time target (minutes) per course when a menu item has none set.
const DEFAULT_PREP = { Appetizers: 8, Mains: 15, Desserts: 6, Drinks: 3 };

// Map a menu category name to a kitchen course for ticket grouping/firing.
function courseFromCategory(cat) {
  const c = (cat || '').toLowerCase();
  if (/starter|appetiz|salad|soup|small plate/.test(c)) return 'Appetizers';
  if (/dessert|sweet/.test(c)) return 'Desserts';
  if (/beverage|drink|wine|coffee|bar/.test(c)) return 'Drinks';
  return 'Mains';
}

// The first course present on an order, following kitchen sequence.
function firstCourse(orderId) {
  const present = db.prepare(`SELECT DISTINCT COALESCE(course,'Mains') c FROM order_items WHERE order_id=?`)
    .all(orderId).map(r => r.c);
  for (const c of COURSE_ORDER) if (present.includes(c)) return c;
  return present[0] || null;
}

// Fire one course: stamp fired_at on its still-held items. Returns rows changed.
function fireCourse(orderId, course) {
  return db.prepare(`UPDATE order_items SET fired_at=datetime('now')
                     WHERE order_id=? AND COALESCE(course,'Mains')=? AND fired_at IS NULL`)
    .run(orderId, course).changes;
}

// Fire every held course on the order.
function fireAll(orderId) {
  return db.prepare(`UPDATE order_items SET fired_at=datetime('now') WHERE order_id=? AND fired_at IS NULL`)
    .run(orderId).changes;
}

// Assign each item its course + prep target from the menu (by name), then fire the
// opening course(s): dine-in holds later courses; to-go fires all. Idempotent — items
// that already have a course keep it.
function applyCoursing(orderId, locationId, dineIn) {
  const lookup = db.prepare(`SELECT c.name AS cat, mi.prep_minutes AS prep
                             FROM menu_items mi JOIN menu_categories c ON mi.category_id=c.id
                             WHERE mi.location_id=? AND mi.name=? LIMIT 1`);
  const setRow = db.prepare(`UPDATE order_items SET course=?, prep_minutes=? WHERE id=?`);
  for (const it of db.prepare(`SELECT id, item_name, course, prep_minutes FROM order_items WHERE order_id=?`).all(orderId)) {
    const m = lookup.get(locationId, it.item_name) || {};
    const course = it.course || courseFromCategory(m.cat);
    const prep = (it.prep_minutes != null) ? it.prep_minutes : (m.prep != null ? m.prep : null);
    setRow.run(course, prep, it.id);
  }
  if (dineIn) { const fc = firstCourse(orderId); if (fc) fireCourse(orderId, fc); }
  else fireAll(orderId);
}

module.exports = { COURSE_ORDER, DEFAULT_PREP, courseFromCategory, firstCourse, fireCourse, fireAll, applyCoursing };
