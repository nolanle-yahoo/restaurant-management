// Global, owner-configurable settings stored in the `settings` key/value table.
// Currently the sales-tax and service-charge rates that apply at bill settlement.
// Falls back to the SALES_TAX_RATE env var, then a sane default, when unset — so
// existing deployments keep working with no configuration.

const db = require('../db/database');

const ENV_TAX = parseFloat(process.env.SALES_TAX_RATE || '0.08');

function getRaw(key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key);
  return row ? row.value : null;
}

function setRaw(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, String(value));
}

// Clamp a parsed rate into a sane 0–100% range; return fallback if invalid.
function rate(value, fallback) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

function getRates() {
  return {
    sales_tax_rate:      rate(getRaw('sales_tax_rate'), ENV_TAX),
    service_charge_rate: rate(getRaw('service_charge_rate'), 0),
  };
}

function setRates({ sales_tax_rate, service_charge_rate }) {
  if (sales_tax_rate !== undefined)      setRaw('sales_tax_rate',      rate(sales_tax_rate, getRates().sales_tax_rate));
  if (service_charge_rate !== undefined) setRaw('service_charge_rate', rate(service_charge_rate, getRates().service_charge_rate));
  return getRates();
}

module.exports = { getRates, setRates };
