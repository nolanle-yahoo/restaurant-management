// SMS wrapper with graceful fallback (mirrors lib/email.js).
// When TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM are set, real texts are
// sent via Twilio. Otherwise it runs in "simulated" mode — nothing leaves the
// server, but every message is recorded in sms_log so flows stay testable in demos.

const db = require('../db/database');

let client = null;
let mode = 'simulated';
const FROM = process.env.TWILIO_FROM || null;
const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;

if (SID && TOKEN && FROM) {
  try {
    client = require('twilio')(SID, TOKEN);
    mode = 'twilio';
  } catch (e) {
    console.warn('Twilio init failed; SMS runs in simulated mode:', e.message);
  }
}

const enabled = mode === 'twilio';

// Best-effort E.164 normalization for North American numbers.
function normalize(num) {
  if (!num) return null;
  const s = String(num).trim();
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, '');
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return digits ? '+' + digits : null;
}

function _log(to, body, category, status) {
  try {
    db.prepare(`INSERT INTO sms_log (to_number, body, category, status) VALUES (?,?,?,?)`)
      .run(to || null, body || null, category || null, status);
  } catch {}
}

// Fire-and-forget; never throws into the request path.
async function sendSMS(to, body, category = 'general') {
  const num = normalize(to);
  if (!num || !body) { _log(to, body, category, 'failed'); return { ok: false }; }
  if (!enabled) {
    _log(num, body, category, 'simulated');
    console.log(`[sms:simulated] → ${num} | ${body}`);
    return { ok: true, simulated: true };
  }
  try {
    await client.messages.create({ from: FROM, to: num, body });
    _log(num, body, category, 'sent');
    return { ok: true };
  } catch (e) {
    _log(num, body, category, 'failed');
    console.error('SMS send failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { enabled, mode, sendSMS };
