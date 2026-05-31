# Payments Setup Guide

The system settles bills in one of two modes. It works fully out of the box; Stripe is optional.

## Mode 1 — Simulated (default, no setup)

If no Stripe keys are configured, card/cash/mobile payments are **recorded** without contacting a
payment processor. Totals, tips, payroll, and sales analytics all work normally. This is ideal for
demos and internal/training use.

Nothing to do — just take an order and click **Settle Bill**.

## Mode 2 — Real Stripe test cards

To exercise a genuine card flow with Stripe's test cards:

1. Create a free account at **https://dashboard.stripe.com** (no activation needed for test mode).
2. Confirm you are in **Test mode** — the toggle is in the top-right of the dashboard.
3. Go to **Developers → API keys** and copy:
   - **Secret key** — starts with `sk_test_`
   - **Publishable key** — starts with `pk_test_`
4. Put them in your `.env` file (the prefixes shown here are placeholders — paste your own):
   ```
   STRIPE_SECRET_KEY=<your sk_test_… secret key>
   STRIPE_PUBLISHABLE_KEY=<your pk_test_… publishable key>
   ```
5. Restart the server: `npm start`. On the Settle Bill screen, **Card** now shows a live card field.
6. Pay with a Stripe **test card**:

   | Scenario | Card number | Extra |
   |---|---|---|
   | Success | `4242 4242 4242 4242` | any future expiry, any CVC, any ZIP |
   | Requires authentication | `4000 0025 0000 3155` | completes a 3-D Secure prompt |
   | Declined | `4000 0000 0000 0002` | card is declined |

   No real money moves while you use test keys.

## How it works internally

- The server reads `STRIPE_SECRET_KEY` at startup (`lib/stripe.js`). If present and valid it uses the
  real Stripe SDK; otherwise it returns simulated payment intents.
- Card payments create a Stripe **PaymentIntent** (`POST /api/payments/intent`), the browser confirms it
  with Stripe.js, and the server verifies and records the result (`POST /api/payments/:id/confirm`).
- Cash/mobile payments are recorded directly (`POST /api/payments`).
- Settling a bill marks the order **served** and the table **ready to clean**, and the tip flows into
  the employee's payroll take-home.

## Security notes

- **Never commit real keys.** `.env` is git-ignored; only `.env.example` (with blanks) is committed.
- Card data is entered into Stripe's hosted field and sent directly to Stripe — it never touches this
  server, keeping PCI scope minimal.
- Refunds are available to owners and managers from the payment history.
