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

module.exports = { verifyToken, requireRole };
