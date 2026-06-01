// Configurable permissions for sensitive actions (refund, void, discount).
// The owner is always allowed. Other staff roles are governed by the
// `permissions` table, which owners edit. This is an additive overlay — base
// route role-gating (middleware/auth requireRole) still applies.

const db = require('../db/database');

const CAPABILITIES = ['refund', 'void', 'discount'];
// Roles that can ever be granted these capabilities (owner is implicit/always).
const GRANTABLE_ROLES = ['manager', 'waiter', 'employee', 'frontdesk'];

// True if the caller may perform `capability`.
function can(req, capability) {
  if (!req.user) return false;
  if (req.user.role === 'owner') return true;
  const row = db.prepare(`SELECT allowed FROM permissions WHERE capability=? AND role=?`).get(capability, req.user.role);
  return !!(row && row.allowed);
}

// Express middleware factory.
function requireCan(capability) {
  return (req, res, next) => {
    if (can(req, capability)) return next();
    return res.status(403).json({ error: `Your role is not permitted to ${capability}.` });
  };
}

// Full matrix for the owner settings UI.
function getMatrix() {
  const rows = db.prepare(`SELECT capability, role, allowed FROM permissions`).all();
  const map = {};
  CAPABILITIES.forEach(c => { map[c] = {}; GRANTABLE_ROLES.forEach(r => { map[c][r] = false; }); });
  rows.forEach(r => { if (map[r.capability] && r.role in map[r.capability]) map[r.capability][r.role] = !!r.allowed; });
  return { capabilities: CAPABILITIES, roles: GRANTABLE_ROLES, matrix: map };
}

function setPermission(capability, role, allowed) {
  if (!CAPABILITIES.includes(capability) || !GRANTABLE_ROLES.includes(role)) {
    throw new Error('Invalid capability or role');
  }
  db.prepare(`
    INSERT INTO permissions (capability, role, allowed) VALUES (?,?,?)
    ON CONFLICT(capability, role) DO UPDATE SET allowed=excluded.allowed
  `).run(capability, role, allowed ? 1 : 0);
}

module.exports = { can, requireCan, getMatrix, setPermission, CAPABILITIES, GRANTABLE_ROLES };
