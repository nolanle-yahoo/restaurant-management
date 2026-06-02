// SMS wrapper with a pluggable provider + graceful simulated fallback.
//
// Choose a provider with SMS_PROVIDER:
//   simulated      – default; nothing leaves the server, recorded in sms_log (great for demos)
//   twilio         – real SMS via Twilio        (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)
//   textbelt       – real SMS via TextBelt       (TEXTBELT_KEY; default key 'textbelt' = 1 free/day;
//                                                 self-host with TEXTBELT_URL for unlimited/free)
//   email_gateway  – free carrier email-to-SMS   (SMS_EMAIL_GATEWAY, e.g. vtext.com / txt.att.net /
//                                                 tmomail.net) — reuses the email layer (needs SMTP)
// If SMS_PROVIDER is unset, it auto-detects Twilio when configured, else simulated.
// Every message is logged to sms_log (status: sent | simulated | failed).

const db = require('../db/database');

const PROVIDER_ENV = (process.env.SMS_PROVIDER || 'auto').toLowerCase();
const TW_SID = process.env.TWILIO_ACCOUNT_SID, TW_TOKEN = process.env.TWILIO_AUTH_TOKEN, TW_FROM = process.env.TWILIO_FROM;

let twilioClient = null;
function initTwilio() {
  if (twilioClient) return true;
  if (TW_SID && TW_TOKEN && TW_FROM) {
    try { twilioClient = require('twilio')(TW_SID, TW_TOKEN); return true; }
    catch (e) { console.warn('Twilio init failed:', e.message); }
  }
  return false;
}

function resolveProvider() {
  switch (PROVIDER_ENV) {
    case 'twilio':        return initTwilio() ? 'twilio' : 'simulated';
    case 'textbelt':      return 'textbelt';
    case 'email_gateway': return process.env.SMS_EMAIL_GATEWAY ? 'email_gateway' : 'simulated';
    case 'simulated':     return 'simulated';
    default:              return initTwilio() ? 'twilio' : 'simulated'; // auto
  }
}

const provider = resolveProvider();
const enabled = provider !== 'simulated';

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

// ── Providers (each returns { ok, simulated? }) ───────────────
async function viaTwilio(num, body) {
  await twilioClient.messages.create({ from: TW_FROM, to: num, body });
  return { ok: true };
}

async function viaTextbelt(num, body) {
  const url = process.env.TEXTBELT_URL || 'https://textbelt.com/text';
  const key = process.env.TEXTBELT_KEY || 'textbelt';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: num, message: body, key }) });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error(data.error || 'TextBelt rejected the message');
  return { ok: true };
}

async function viaEmailGateway(num, body, category) {
  const gw = process.env.SMS_EMAIL_GATEWAY;
  if (!gw) throw new Error('SMS_EMAIL_GATEWAY not set');
  const { sendEmail } = require('./email');
  // US carrier gateways expect the 10-digit number.
  let digits = num.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  const r = await sendEmail(`${digits}@${gw}`, '', body, 'sms_' + category);
  return { ok: !!r.ok, simulated: !!r.simulated }; // simulated if SMTP isn't configured
}

// Fire-and-forget; never throws into the request path.
async function sendSMS(to, body, category = 'general') {
  const num = normalize(to);
  if (!num || !body) { _log(to, body, category, 'failed'); return { ok: false }; }
  if (provider === 'simulated') {
    _log(num, body, category, 'simulated');
    console.log(`[sms:simulated] → ${num} | ${body}`);
    return { ok: true, simulated: true };
  }
  try {
    let r;
    if (provider === 'twilio')             r = await viaTwilio(num, body);
    else if (provider === 'textbelt')      r = await viaTextbelt(num, body);
    else if (provider === 'email_gateway') r = await viaEmailGateway(num, body, category);
    else throw new Error('Unknown SMS provider: ' + provider);
    _log(num, body, category, r.ok ? (r.simulated ? 'simulated' : 'sent') : 'failed');
    return r;
  } catch (e) {
    _log(num, body, category, 'failed');
    console.error('SMS send failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { enabled, provider, sendSMS };
