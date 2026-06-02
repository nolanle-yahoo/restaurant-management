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

function simId(prefix) { return prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

// amountCents: integer cents. opts: { customerId, savePm } — attach a Stripe
// customer and/or save the card for reuse. Returns { id, client_secret, simulated }.
async function createIntent(amountCents, metadata = {}, opts = {}) {
  if (!enabled) {
    return { id: 'sim_' + simId('pi_'), client_secret: null, simulated: true };
  }
  const params = { amount: amountCents, currency: 'usd', metadata, automatic_payment_methods: { enabled: true } };
  if (opts.customerId) params.customer = opts.customerId;
  if (opts.savePm && opts.customerId) params.setup_future_usage = 'off_session';
  const pi = await stripe.paymentIntents.create(params);
  return { id: pi.id, client_secret: pi.client_secret, simulated: false };
}

// Create + confirm a charge against a previously-saved card (off-session reuse).
// Returns { id, status, simulated }.
async function chargeSavedCard(amountCents, customerId, paymentMethodId, metadata = {}) {
  if (!enabled) return { id: 'sim_' + simId('pi_'), status: 'succeeded', simulated: true };
  const pi = await stripe.paymentIntents.create({
    amount: amountCents, currency: 'usd', metadata,
    customer: customerId, payment_method: paymentMethodId,
    off_session: true, confirm: true,
  });
  return { id: pi.id, status: pi.status, simulated: false };
}

// Ensure a Stripe Customer exists; returns its id (or a simulated id).
async function ensureCustomer({ email, name, existingId }) {
  if (!enabled) return existingId || 'sim_' + simId('cus_');
  if (existingId) { try { const c = await stripe.customers.retrieve(existingId); if (c && !c.deleted) return existingId; } catch {} }
  const c = await stripe.customers.create({ email: email || undefined, name: name || undefined });
  return c.id;
}

// Brand/last4/exp + pm id for the card used on a confirmed intent (for saving).
async function cardFromIntent(intentId) {
  if (!enabled || !intentId || intentId.startsWith('sim_')) {
    return { stripe_pm_id: 'sim_pm_' + Math.random().toString(36).slice(2, 10), brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 };
  }
  const pi = await stripe.paymentIntents.retrieve(intentId, { expand: ['payment_method'] });
  const pm = pi.payment_method;
  if (!pm || !pm.card) return null;
  return { stripe_pm_id: pm.id, brand: pm.card.brand, last4: pm.card.last4, exp_month: pm.card.exp_month, exp_year: pm.card.exp_year };
}

async function detachCard(pmId) {
  if (!enabled || !pmId || pmId.startsWith('sim_')) return { simulated: true };
  return stripe.paymentMethods.detach(pmId);
}

// Returns the PaymentIntent status, or 'succeeded' in simulated mode.
async function retrieveStatus(intentId) {
  if (!enabled || !intentId || intentId.startsWith('sim_')) return 'succeeded';
  const pi = await stripe.paymentIntents.retrieve(intentId);
  return pi.status;
}

// Returns { status, amount } for an intent. In simulated mode amount is null
// (no real charge to verify against).
async function retrieveIntent(intentId) {
  if (!enabled || !intentId || intentId.startsWith('sim_')) return { status: 'succeeded', amount: null };
  const pi = await stripe.paymentIntents.retrieve(intentId);
  return { status: pi.status, amount: pi.amount };
}

async function refund(intentId) {
  if (!enabled || !intentId || intentId.startsWith('sim_')) return { simulated: true };
  return stripe.refunds.create({ payment_intent: intentId });
}

module.exports = { enabled, createIntent, retrieveStatus, retrieveIntent, refund };
