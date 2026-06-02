// Inventory lots & FIFO consumption.
//
// Received stock can be recorded as a *lot* with an expiry date. When stock is
// consumed (a sale depletes ingredients, waste is logged, a transfer ships out),
// we draw down lots in FIFO order — earliest expiry first, then earliest received
// — so older stock is used before it spoils. The `inventory.quantity` column stays
// the authoritative total; lots are a parallel ledger for expiry/traceability.
// Consumption is best-effort and tolerant: stock received before lots existed
// simply isn't lot-tracked, so consumeFIFO consumes whatever lots exist and stops.

const db = require('./database');

// Record a received batch as a lot. Returns the new lot id.
function receiveLot({ item_id, location_id, quantity, unit_cost = 0, expiry_date = null, lot_code = null, user_id = null }) {
  const qty = Math.max(0, Number(quantity) || 0);
  if (!item_id || qty <= 0) return null;
  const r = db.prepare(`
    INSERT INTO inventory_lots (item_id, location_id, lot_code, received_qty, quantity, unit_cost, expiry_date, received_by)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(item_id, location_id || null, lot_code || null, qty, qty, Number(unit_cost) || 0, expiry_date || null, user_id || null);
  return r.lastInsertRowid;
}

// Consume `qty` units of an item from its lots, earliest-expiry-first. Lots with
// no expiry sort last. Returns the quantity actually drawn from tracked lots.
function consumeFIFO(itemId, qty) {
  let remaining = Math.max(0, Number(qty) || 0);
  if (!itemId || remaining <= 0) return 0;
  let consumed = 0;
  try {
    const lots = db.prepare(`
      SELECT id, quantity FROM inventory_lots
      WHERE item_id=? AND quantity > 0
      ORDER BY (expiry_date IS NULL), expiry_date ASC, received_at ASC, id ASC
    `).all(itemId);
    const setQty = db.prepare(`UPDATE inventory_lots SET quantity=?, depleted_at=CASE WHEN ?<=0 THEN datetime('now') ELSE depleted_at END WHERE id=?`);
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.quantity, remaining);
      const next = Math.round((lot.quantity - take) * 1000) / 1000;
      setQty.run(next, next, lot.id);
      remaining = Math.round((remaining - take) * 1000) / 1000;
      consumed += take;
    }
  } catch (e) {
    console.error('consumeFIFO failed:', e.message);
  }
  return consumed;
}

module.exports = { receiveLot, consumeFIFO };
