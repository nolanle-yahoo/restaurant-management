const db = require('../db/database');

function auditLog(req, action, entityType = null, entityId = null, details = null) {
  try {
    db.prepare(`
      INSERT INTO audit_log (user_id, user_name, user_role, location_id, action, entity_type, entity_id, details)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      req.user?.id || null,
      req.user?.name || null,
      req.user?.role || null,
      req.user?.location_id || null,
      action,
      entityType,
      entityId,
      details ? JSON.stringify(details) : null
    );
  } catch {}
}

module.exports = { auditLog };
