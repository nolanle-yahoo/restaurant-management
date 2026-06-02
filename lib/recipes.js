// Inventory auto-depletion (recipes / bill-of-materials) and auto-"86".
//
// When an order is placed, each ordered menu item consumes its recipe's
// ingredients from that location's inventory. Order lines store the item *name*
// (the menu picker sends name + price), so we map back to the menu item by
// (location_id, name). Any ingredient that drops below what a single serving of
// a dependent menu item needs causes that item to be auto-marked unavailable
// ("86'd"), so it can't be ordered again until restocked.
//
// Runs synchronously inside the order request and never throws into it.

const db = require('../db/database');
const { auditLog } = require('./audit');
const { notify } = require('./ws');
const { consumeFIFO } = require('./lots');

// Decrement ingredients for every line of an order; returns the set of touched
// inventory ids so callers can re-check availability.
function depleteForOrder(req, orderId, locationId) {
  const touched = new Set();
  try {
    const lines = db.prepare(`SELECT item_name, quantity FROM order_items WHERE order_id=?`).all(orderId);
    const findItem = db.prepare(`SELECT id FROM menu_items WHERE location_id=? AND name=?`);
    const recipeFor = db.prepare(`SELECT inventory_id, quantity FROM recipes WHERE menu_item_id=?`);
    const invRow = db.prepare(`SELECT quantity, min_quantity, item_name, unit FROM inventory WHERE id=?`);
    const setQty = db.prepare(`UPDATE inventory SET quantity=?, last_updated=datetime('now') WHERE id=?`);
    const logTxn = db.prepare(`INSERT INTO inventory_transactions (item_id, from_location_id, quantity, type, user_id, notes) VALUES (?,?,?,'out',?,?)`);

    lines.forEach(line => {
      const mi = findItem.get(locationId, line.item_name);
      if (!mi) return;
      recipeFor.all(mi.id).forEach(r => {
        const used = (r.quantity || 0) * (line.quantity || 1);
        if (used <= 0) return;
        const inv = invRow.get(r.inventory_id);
        if (!inv) return;
        const next = Math.max(0, Math.round((inv.quantity - used) * 1000) / 1000);
        setQty.run(next, r.inventory_id);
        consumeFIFO(r.inventory_id, used);
        logTxn.run(r.inventory_id, locationId, used, req.user?.id || null, `Auto-deplete: order #${orderId} (${line.item_name})`);
        touched.add(r.inventory_id);
        // Alert the supply chain the moment an item crosses below its threshold.
        if (inv.quantity >= inv.min_quantity && next < inv.min_quantity) {
          notify(`Low stock: ${inv.item_name} (${next} ${inv.unit || ''} left)`,
            { locId: locationId, roles: ['manager', 'stockroom', 'chef'], kind: 'low_stock' });
        }
      });
    });

    if (touched.size) autoUnavailable(req, locationId, [...touched]);
  } catch (e) {
    console.error('depleteForOrder failed:', e.message);
  }
  return [...touched];
}

// Mark menu items unavailable when any of their ingredients can no longer cover
// a single serving. Returns the list of items that were just 86'd.
function autoUnavailable(req, locationId, inventoryIds) {
  const eightySixed = [];
  try {
    // Menu items at this location whose recipe uses any of the touched ingredients.
    const placeholders = inventoryIds.map(() => '?').join(',');
    const candidates = db.prepare(`
      SELECT DISTINCT mi.id, mi.name
      FROM menu_items mi
      JOIN recipes r ON r.menu_item_id = mi.id
      WHERE mi.location_id = ? AND mi.is_available = 1 AND r.inventory_id IN (${placeholders})
    `).all(locationId, ...inventoryIds);

    const recipeFor = db.prepare(`
      SELECT r.quantity AS need, i.quantity AS have
      FROM recipes r JOIN inventory i ON i.id = r.inventory_id
      WHERE r.menu_item_id = ?
    `);
    const mark = db.prepare(`UPDATE menu_items SET is_available=0 WHERE id=?`);

    candidates.forEach(mi => {
      const short = recipeFor.all(mi.id).some(ing => (ing.need || 0) > 0 && (ing.have || 0) < ing.need);
      if (short) { mark.run(mi.id); eightySixed.push(mi.name); }
    });

    if (eightySixed.length) {
      auditLog(req, 'menu_item_auto_86', 'menu_item', null, { location_id: locationId, items: eightySixed });
    }
  } catch (e) {
    console.error('autoUnavailable failed:', e.message);
  }
  return eightySixed;
}

// Adjust inventory for a single line by a signed quantity delta (order edit).
// Positive delta consumes more stock; negative delta restocks. Depletion can
// trigger auto-86 just like a new order.
function adjustForLine(req, orderId, locationId, itemName, qtyDelta) {
  try {
    if (!qtyDelta) return;
    const mi = db.prepare(`SELECT id FROM menu_items WHERE location_id=? AND name=?`).get(locationId, itemName);
    if (!mi) return;
    const recipe = db.prepare(`SELECT inventory_id, quantity FROM recipes WHERE menu_item_id=?`).all(mi.id);
    const invRow = db.prepare(`SELECT quantity FROM inventory WHERE id=?`);
    const setQty = db.prepare(`UPDATE inventory SET quantity=?, last_updated=datetime('now') WHERE id=?`);
    const logOut = db.prepare(`INSERT INTO inventory_transactions (item_id, from_location_id, quantity, type, user_id, notes) VALUES (?,?,?,'out',?,?)`);
    const logIn  = db.prepare(`INSERT INTO inventory_transactions (item_id, to_location_id, quantity, type, user_id, notes) VALUES (?,?,?,'in',?,?)`);
    const touched = [];
    recipe.forEach(r => {
      const used = (r.quantity || 0) * qtyDelta; // signed
      if (!used) return;
      const inv = invRow.get(r.inventory_id); if (!inv) return;
      const next = Math.max(0, Math.round((inv.quantity - used) * 1000) / 1000);
      setQty.run(next, r.inventory_id);
      if (used > 0) logOut.run(r.inventory_id, locationId, used, req.user?.id || null, `Auto-deplete: order #${orderId} (edit)`);
      else          logIn.run(r.inventory_id, locationId, -used, req.user?.id || null, `Edit restock: order #${orderId}`);
      touched.push(r.inventory_id);
    });
    if (qtyDelta > 0 && touched.length) autoUnavailable(req, locationId, touched);
  } catch (e) { console.error('adjustForLine failed:', e.message); }
}

module.exports = { depleteForOrder, autoUnavailable, adjustForLine };
