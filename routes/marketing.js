// Email marketing — owner-only campaign sending to opted-in customers.
// Reuses the shared email layer (real SMTP or simulated/logged). Every message
// carries a one-click unsubscribe link, and only customers who opted in are sent.

const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { auditLog } = require('../lib/audit');
const { sendEmail } = require('../lib/email');

const router = express.Router();
router.use(verifyToken);

const BASE = () => process.env.ALLOWED_ORIGIN || 'http://localhost:3000';

// Size of the opt-in audience (for the composer).
router.get('/audience', requireRole('owner'), (req, res) => {
  const total = db.prepare(`SELECT COUNT(*) n FROM customers`).get().n;
  const opted = db.prepare(`SELECT COUNT(*) n FROM customers WHERE marketing_opt_in=1 AND email IS NOT NULL`).get().n;
  res.json({ total_customers: total, opted_in: opted });
});

// Recent campaigns (from the email log).
router.get('/history', requireRole('owner'), (req, res) => {
  const rows = db.prepare(`
    SELECT subject, status, created_at FROM email_log
    WHERE category='marketing' ORDER BY created_at DESC LIMIT 100
  `).all();
  res.json(rows);
});

// Send a campaign to every opted-in customer.
router.post('/send', requireRole('owner'), async (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!subject || !body) return res.status(400).json({ error: 'Subject and message are required.' });

  const recipients = db.prepare(`SELECT name, email, unsubscribe_token FROM customers WHERE marketing_opt_in=1 AND email IS NOT NULL`).all();
  if (!recipients.length) return res.status(400).json({ error: 'No opted-in customers to send to.' });

  let sent = 0;
  for (const c of recipients) {
    const footer = `\n\n— \nYou are receiving this because you opted in to marketing emails.\n` +
                   `Unsubscribe: ${BASE()}/unsubscribe.html?token=${c.unsubscribe_token}`;
    const r = await sendEmail(c.email, subject, `Hi ${c.name || 'there'},\n\n${body}${footer}`, 'marketing');
    if (r && r.ok) sent++;
  }
  auditLog(req, 'marketing_campaign_sent', 'marketing', null, { subject, recipients: recipients.length, sent });
  res.json({ success: true, recipients: recipients.length, sent });
});

module.exports = router;
