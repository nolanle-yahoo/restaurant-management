const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLog } = require('../lib/audit');
const { getRates, setRates, getDeposit, setDeposit } = require('../lib/settings');
const { getMatrix, setPermission } = require('../lib/permissions');

const router = express.Router();
router.use(verifyToken);

// Configurable permission matrix (sensitive actions × roles).
router.get('/permissions', requireRole('owner'), (req, res) => {
  res.json(getMatrix());
});
router.put('/permissions', requireRole('owner'), (req, res) => {
  const { capability, role, allowed } = req.body;
  try {
    setPermission(capability, role, allowed);
    auditLog(req, 'permission_update', 'permission', null, { capability, role, allowed: !!allowed });
    res.json({ success: true, ...getMatrix() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Read current global settings (owner/manager can view; only owner edits).
router.get('/', requireRole('owner', 'manager'), (req, res) => {
  res.json({ ...getRates(), ...getDeposit() });
});

// Update tax / service-charge rates (fractions, 0–1) and reservation deposit policy.
router.put('/', requireRole('owner'), (req, res) => {
  const { sales_tax_rate, service_charge_rate, reservation_deposit, reservation_deposit_min_party } = req.body;
  setRates({ sales_tax_rate, service_charge_rate });
  setDeposit({ reservation_deposit, reservation_deposit_min_party });
  const updated = { ...getRates(), ...getDeposit() };
  auditLog(req, 'settings_update', 'settings', null, updated);
  res.json({ success: true, ...updated });
});

module.exports = router;
