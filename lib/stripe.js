// Stripe wrapper with graceful fallback.
// When STRIPE_SECRET_KEY is set, real Stripe PaymentIntents are used.
// When it is absent, the module runs in "simulated" mode so the system
// remains fully functional for demos/internal use (no real charge).

let stripe = null;
const key = process.env.STRIPE_SECRET_KEY;
if (key && key.startsWith('sk_')) {
  try { stripe = require('stripe')(key); }
  catch (e) { console.warn('Stripe SDK init failed; running in simulated mode:', e.message); }
}

const enabled = !!stripe;

// amountCents: integer cents. Returns { id, client_secret }.
async function createIntent(amountCents, metadata = {}) {
  if (!enabled) {
    // Simulated intent — no external call.
    return { id: 'sim_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), client_secret: null, simulated: true };
  }
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    metadata,
    automatic_payment_methods: { enabled: true },
  });
  return { id: pi.id, client_secret: pi.client_secret, simulated: false };
}

// Returns the PaymentIntent status, or 'succeeded' in simulated mode.
async function retrieveStatus(intentId) {
  if (!enabled || !intentId || intentId.startsWith('sim_')) return 'succeeded';
  const pi = await stripe.paymentIntents.retrieve(intentId);
  return pi.status;
}

async function refund(intentId) {
  if (!enabled || !intentId || intentId.startsWith('sim_')) return { simulated: true };
  return stripe.refunds.create({ payment_intent: intentId });
}

module.exports = { enabled, createIntent, retrieveStatus, refund };
