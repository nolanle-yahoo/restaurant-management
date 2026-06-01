// Email wrapper with graceful fallback.
// When SMTP_* env vars are set, real email is sent via nodemailer.
// Otherwise it runs in "simulated" mode — nothing leaves the server, but every
// message is recorded in the email_log table so flows stay testable in demos.

const db = require('../db/database');

let transporter = null;
let mode = 'simulated';
const FROM = process.env.MAIL_FROM || 'Restaurant <no-reply@restaurant.local>';

if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    mode = 'smtp';
  } catch (e) {
    console.warn('Nodemailer init failed; email runs in simulated mode:', e.message);
  }
}

const enabled = mode === 'smtp';

function _log(to, subject, body, category, status) {
  try {
    db.prepare(`INSERT INTO email_log (to_email, subject, body, category, status) VALUES (?,?,?,?,?)`)
      .run(to || null, subject || null, body || null, category || null, status);
  } catch {}
}

// Fire-and-forget; never throws into the request path.
async function sendEmail(to, subject, body, category = 'general') {
  if (!to) { _log(to, subject, body, category, 'failed'); return { ok: false }; }
  if (!enabled) {
    _log(to, subject, body, category, 'simulated');
    console.log(`[email:simulated] → ${to} | ${subject}`);
    return { ok: true, simulated: true };
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, text: body });
    _log(to, subject, body, category, 'sent');
    return { ok: true };
  } catch (e) {
    _log(to, subject, body, category, 'failed');
    console.error('Email send failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { enabled, mode, sendEmail };
