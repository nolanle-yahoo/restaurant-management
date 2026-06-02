// Optional Telegram bot notifier for operational alerts (new orders, reservations).
//
// Telegram is keyed by a chat id, not a phone number, so this is a business/ops
// push channel (the bot posts to one configured chat that staff/owner are in) —
// not a per-guest SMS replacement. It's free and reliable.
//
// Setup: message @BotFather → /newbot → copy the token into TELEGRAM_BOT_TOKEN.
// Add the bot to a group (or DM it), then set TELEGRAM_CHAT_ID to that chat's id
// (find it via https://api.telegram.org/bot<token>/getUpdates after sending a msg).
// Without both vars, alerts are simulated (recorded in telegram_log).

const db = require('../db/database');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const enabled = !!(TOKEN && CHAT);

function _log(text, category, status) {
  try {
    db.prepare(`INSERT INTO telegram_log (chat_id, body, category, status) VALUES (?,?,?,?)`)
      .run(CHAT || null, text || null, category || null, status);
  } catch {}
}

// Fire-and-forget; never throws into the request path.
async function sendTelegram(text, category = 'ops') {
  if (!text) return { ok: false };
  if (!enabled) {
    _log(text, category, 'simulated');
    console.log(`[telegram:simulated] ${text}`);
    return { ok: true, simulated: true };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, disable_web_page_preview: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.description || 'Telegram API error');
    _log(text, category, 'sent');
    return { ok: true };
  } catch (e) {
    _log(text, category, 'failed');
    console.error('Telegram send failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { enabled, sendTelegram };
