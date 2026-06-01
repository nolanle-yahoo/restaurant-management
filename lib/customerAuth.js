// Customer authentication — separate from staff (`middleware/auth.js`). Customer
// JWTs carry `kind: 'customer'` so they can never be used on staff endpoints and
// vice-versa. Tokens are signed with the same JWT_SECRET.

const jwt = require('jsonwebtoken');

function signCustomer(c) {
  return jwt.sign(
    { cid: c.id, name: c.name, email: c.email, kind: 'customer' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

// Returns the verified customer payload, or null.
function verifyCustomer(token) {
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    return p && p.kind === 'customer' ? p : null;
  } catch {
    return null;
  }
}

// Best-effort customer id from the request's bearer token (null if absent/invalid).
function customerIdFromReq(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const p = verifyCustomer(auth.slice(7));
  return p ? p.cid : null;
}

// Middleware guarding customer-only endpoints.
function requireCustomer(req, res, next) {
  const id = customerIdFromReq(req);
  if (!id) return res.status(401).json({ error: 'Please sign in to your account.' });
  req.customerId = id;
  next();
}

module.exports = { signCustomer, verifyCustomer, customerIdFromReq, requireCustomer };
