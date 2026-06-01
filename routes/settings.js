const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLog } = require('../lib/audit');
const { getRates, setRates } = require('../lib/settings');

const router = express.Router();
router.use(verifyToken);

// Read current global settings (owner/manager can view; only owner edits).
router.get('/', requireRole('owner', 'manager'), (req, res) => {
  res.json(getRates());
});

// Update tax / service-charge rates. Rates are fractions (0.08 = 8%), 0–1.
router.put('/', requireRole('owner'), (req, res) => {
  const { sales_tax_rate, service_charge_rate } = req.body;
  const updated = setRates({ sales_tax_rate, service_charge_rate });
  auditLog(req, 'settings_update', 'settings', null, updated);
  res.json({ success: true, ...updated });
});

module.exports = router;
