const jwt = require('jsonwebtoken');
const db = require('../db/database');

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  let payload;
  try {
    payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Session revocation: the token carries the user's token_version (tv) at
  // issue time. Bumping the stored version (logout-all, deactivation, password
  // change/reset) invalidates every previously issued token immediately.
  const row = db.prepare(`SELECT token_version, is_active FROM users WHERE id=?`).get(payload.id);
  if (!row || row.is_active === 0) {
    return res.status(401).json({ error: 'Account is no longer active' });
  }
  if ((payload.tv || 0) !== (row.token_version || 0)) {
    return res.status(401).json({ error: 'Session has been revoked. Please sign in again.' });
  }

  req.user = payload;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Floor operations require the staff member to be on the clock. The owner is
// exempt (oversight role, never clocks in); everyone else must have an open
// clock_records row (clocked in, not yet clocked out).
function isOnDuty(userId) {
  return !!db.prepare(`SELECT 1 FROM clock_records WHERE user_id=? AND check_out IS NULL`).get(userId);
}

function requireOnDuty(req, res, next) {
  if (req.user.role === 'owner') return next();
  if (!isOnDuty(req.user.id)) {
    return res.status(403).json({ error: 'You must be clocked in to do this. Please clock in first.' });
  }
  next();
}

module.exports = { verifyToken, requireRole, requireOnDuty, isOnDuty };
