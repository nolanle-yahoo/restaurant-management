# Restaurant Management System — Enhancement Recommendations

**Companion to:** `DOCUMENTATION.md` (functional & technical reference)
**Status:** Advisory backlog
**Organization:** Ordered **ascending by impact** — Tier 1 (smallest) → Tier 5 (highest / transformational).

> ✅ **Delivered in v1.9.0:** #1 Refund UI · #2 Low-stock alerts (stockroom + chef) ·
> #3 Configurable tax/service-charge · #4 Stronger password policy + broader rate limiting ·
> #20 Chef "86" with live availability · #43 Inventory auto-depletion (recipes/BOM) + auto-86.
> ✅ **Delivered in v1.10.0:** #44 Operational + real-time notifications · #45 Online ordering
> (pickup/delivery, pay-on-collection).
> ✅ **Delivered in v1.11.0:** #35 QR-code table ordering · #37 Customer accounts + loyalty
> (points accrual) · #38 Email marketing with opt-in/unsubscribe.
> ✅ **Delivered in v1.12.0:** loyalty **redemption** (points → discount) · two-way **threaded
> replies** + **broadcast announcements** (#12 staff messaging).
> ✅ **Delivered in v1.13.0:** configurable **permissions** (refund/void/discount × role) ·
> **discounts/comps/voids** · loyalty **tiers + referrals**.
> ✅ **Delivered in v1.14.0:** **split-the-bill** · menu **allergens/photos + dietary filter** ·
> **post-visit receipt feedback**.
> ✅ **Delivered in v1.15.0:** **table transfer/merge** · **waste/spoilage tracking** ·
> **consolidated approvals dashboard**.
> ✅ **Delivered in v1.16.0:** **vendor master records** · **self-service My Pay & Tips** ·
> **course tagging + kitchen grouping**.
> ✅ **Delivered in v1.17.0:** **order edit** (add/change-qty/remove with inventory re-depletion + audit).
> ✅ **Delivered in v1.18.0:** **cycle counts** · **per-employee performance** · **certification tracking**.
> ✅ **Delivered in v1.19.0:** **walk-in waitlist** · **SKU/scan-to-receive** · **inventory valuation & COGS**.
> ✅ **Delivered in v1.20.0:** **staff scheduling** (weekly editor + My Schedule) — unblocks shift swapping.
> ✅ **Delivered in v1.21.0:** **shift swapping** (offer → claim → owner/manager approval).
> ✅ **Delivered in v1.22.0:** **expiry / lot (FIFO) tracking** (dated lots, FIFO use, expiring-soon panel, discard-to-waste).
> ✅ **Delivered in v1.23.0:** **regions + regional-manager role + cross-location staff lending**.
> ✅ **Delivered in v1.24.0:** **central menu with per-location overrides** (template + apply-to-all + protected price overrides + reset-to-central).

Each item notes a rough **effort** (XS/S/M/L) and, where applicable, the roadmap tag (**R#**)
from `DOCUMENTATION.md` §15. These are recommendations for end users across every role
(customer, owner/admin, manager, chef, waiter, front desk, employee, stockroom/warehouse) plus
cross-cutting concerns: staff communication, multi-location operations, and advertising/marketing.

---

## Highest-value gaps at a glance

| Priority | Gap | Who benefits | Tier |
|---|---|---|---|
| ✅ done | Inventory auto-depletion (sell an item → decrement ingredients) — *shipped v1.9.0* | Stockroom, Manager, Owner | 5 |
| ✅ done | Operational + real-time notifications — *shipped v1.10.0* | Waiter, Chef, Front Desk | 5 |
| ✅ done | Online ordering (pickup/delivery) — *shipped v1.10.0* | Customer, Owner | 5 |
| ✅ done | QR-code table ordering — *shipped v1.11.0* | Customer, Owner | 4 |
| ✅ done | Customer accounts + loyalty + marketing email — *shipped v1.11.0* | Customer, Owner | 4 |
| ✅ done | Two-way / broadcast staff messaging — *shipped v1.12.0* | All staff | 2–3 |
| ✅ done | Loyalty redemption — *shipped v1.12.0* | Customer, Owner | 4 |
| ✅ done | Configurable permissions + discounts/comps/voids — *shipped v1.13.0* | Owner, Manager | 3–4 |
| ✅ done | Loyalty tiers + referrals — *shipped v1.13.0* | Customer, Owner | 4 |
| ✅ done | Split the bill (partial payments) — *shipped v1.14.0* | Waiter, Manager | 3 |
| ✅ done | Menu allergens/photos + dietary filter; ticket flags; receipt feedback — *shipped v1.14.0* | Customer, Chef | 1 |
| ✅ done | Table transfer/merge · waste tracking · approvals dashboard — *shipped v1.15.0* | Floor, Stockroom, Mgr | 2–3 |
| ✅ done | Vendor records · self-service pay · course grouping — *shipped v1.16.0* | Stockroom, Staff, Chef | 2–3 |
| ✅ done | Order edit (add/remove items, re-deplete + audit) — *shipped v1.17.0* | Waiter, Chef | 3 |
| ✅ done | Cycle counts · per-employee performance · certification tracking — *shipped v1.18.0* | Stockroom, Mgr | 2–3 |
| ✅ done | Waitlist · SKU/scan-receive · valuation & COGS — *shipped v1.19.0* | Front desk, Stockroom, Owner | 2–3 |
| ✅ done | Staff scheduling (weekly editor + My Schedule) — *shipped v1.20.0* | Owner, Mgr, Staff | 3 |
| ✅ done | Shift swapping (offer → claim → approval) — *shipped v1.21.0* | Staff, Mgr | 2 |
| ✅ done | Expiry/lot (FIFO) tracking — *shipped v1.22.0* | Stockroom, Mgr, Chef | 3 |
| ✅ done | Regional manager role & cross-location staff lending — *shipped v1.23.0* | Owner, Regional | 3 |
| ✅ done | Central menu w/ per-location overrides — *shipped v1.24.0* | Owner, Manager | 3 |
| ✅ done | Customer reviews + activity log for managers, with date/location filters — *shipped v1.42.0* | Owner, Manager | 2 |
| 🔴 1 | 2FA for owner/manager | Owner | 3–4 |

---

## Tier 1 — Smallest impact (polish / hygiene, mostly tiny effort)
1. ✅ **DONE (v1.9.0)** — **Refund UI button** in the Payments & Refunds table (owner + manager).
2. ✅ **DONE (v1.9.0)** — **Low-stock alerts** now shown to the stockroom role and on the Chef Station.
3. ✅ **DONE (v1.9.0)** — **Configurable tax/service-charge** via owner Settings (env value is the fallback).
4. ✅ **DONE (v1.9.0)** — **Password minimum raised to 8** and password-change rate-limited per user.
5. **Allergen/dietary filters + photos** on the public menu. *S*
6. **Structured allergen flags** on kitchen tickets (vs. free-text). *S*
7. **Post-visit feedback link on the receipt**. *S*
8. **Shift-handover notes log**. *S*
9. **SEO-friendly public pages**. *S*

## Tier 2 — Low-to-moderate
10. **Course firing** (hold/fire appetizers vs. mains). *S–M*
11. **Table transfer / merge** orders. *M*
12. **Two-way threaded message replies** (messaging is one-directional today). *M*
13. **Per-location message channels**. *M*
14. **Consolidated approvals dashboard** (time-off + transfers + supply). *M*
15. **Certification/training tracking** with expiry alerts. *M*
16. **Cycle counts / barcode (SKU) scanning** for receiving & counts. *M*
17. **Prep-time estimates / bump-bar** kitchen workflow. *M*
18. **Promo codes & time-based pricing** (happy hour). *M*
19. **Gift cards**. *M*

## Tier 3 — Moderate
20. ✅ **DONE (v1.9.0)** — **Chef "86" items → live availability**: the Chef Station Menu Availability panel flips items on/off, and items auto-86 when ingredients run out.
21. **Split the bill** (by guest or item) (R5). *M*
22. **Order edit/void after sending** with manager approval + audit. *M*
23. **Vendor master records** (lead time, pricing, history). *M*
24. ✅ **DONE** — **Waste/spoilage logging** (v1.15.0) + **expiry/lot (FIFO) tracking** (v1.22.0): dated receiving lots, FIFO consumption, an expiring-soon panel, and discard-to-waste.
25. **Per-employee performance metrics** (sales/waiter, table-turn, tips). *M*
26. **Discounts / comps / voids** with approval + audit. *M*
27. ✅ **DONE (v1.21.0)** — **Shift swapping** (R8): staff offer a shift → colleague claims → owner/manager approves the reassignment.
28. ✅ **DONE (v1.21.0)** — **Self-service staff portal**: Account Settings → My Schedule shows upcoming shifts and drives shift offers/claims (alongside My Pay & Tips from v1.16.0).
29. **Broadcast announcements** (manager/owner → staff). *M*
30. **Reservation reminders** + real-time availability + **waitlist** (R9). *M*
31. ✅ **DONE (v1.23.0)** — **Regional grouping + regional-manager role + cross-location staff lending**: owners group locations into regions, promote a region-scoped `regional` manager with a KPI overview, and lend/return staff between locations.
32. ✅ **DONE (v1.24.0)** — **Central menu with per-location overrides**: one owner-managed template, "apply to all locations" sync, protected price overrides, and reset-to-central.
33. **2FA for owner/manager** (R7). *M* — security-critical
34. **Inventory valuation & COGS** reporting. *M*

## Tier 4 — High impact
35. ✅ **DONE (v1.11.0)** — **QR-code table ordering**: printable per-table QR codes open the
    menu in table mode; guests order dine-in straight to the kitchen.
36. **Par levels + auto-reorder suggestions** (draft POs below threshold). *M–L*
37. ✅ **DONE (v1.11.0)** — **Customer accounts + loyalty**: register/sign-in, order history,
    1 point per $1 on paid orders. (Redemption + referrals remain follow-ups.)
38. ✅ **DONE (v1.11.0)** — **Email marketing**: owner campaign composer to opted-in customers
    with one-click unsubscribe and consent capture.
39. **Configurable roles & permissions** (RBAC is hard-coded to 7 roles today). *L*
40. **Executive multi-location dashboard + benchmarking**. *M–L*
41. **Demand-based / labor-cost scheduling**. *L*
42. **Finance/accounting export & integration** (QuickBooks/Xero), scheduled reports, payroll export. *M–L*

## Tier 5 — Highest impact (transformational / strategic)
43. ✅ **DONE (v1.9.0)** — **Inventory auto-depletion**: recipes/BOM link menu items → ingredients;
    orders decrement stock (logged, clamped at 0) and auto-86 items when ingredients run short.
    (Defining richer recipes, par levels, and COGS reporting remain follow-ups.)
44. ✅ **DONE (v1.10.0)** — **Operational + real-time notifications**: role-targeted toasts for
    order-ready, needs-help, low-stock, new online orders, plus reservation reminders.
45. ✅ **DONE (v1.10.0)** — **Online ordering (pickup/delivery)**: public order page with cart +
    tracking, server-priced, kitchen-integrated, manager fulfillment panel.
46. ✅ **DONE (v1.29.0)** — **Online prepayment + tipping (Stripe)**: card prepay at checkout with
    tip presets/custom and a full breakdown; two-step intent→confirm flow creates the paid order
    only after payment succeeds (idempotent, amount-verified); simulated without keys.
47. ✅ **DONE (v1.30.0)** — **Apple Pay / Google Pay + saved cards**: checkout uses the Stripe
    Payment Element (auto-offers wallets on supported devices); signed-in customers can save a
    card (Stripe Customer; only brand/last4/expiry stored locally) and reuse it off-session, or
    manage cards under My Account.
48. ✅ **DONE (v1.31.0)** — **Delivery dispatch + driver tracking**: `driver` role + app, manager
    dispatch board with ETA, driver status updates + live GPS sharing, and a customer
    live-tracking timeline + map.
49. ✅ **DONE (v1.32.0)** — **SMS notifications (Twilio)**: order received, payment received,
    ready-for-pickup, delivery on-the-way/delivered, and reservation request texts; simulated
    (sms_log) without keys. (v1.33.0 added free TextBelt / carrier-gateway providers; v1.34.0 a
    Telegram ops notifier.)
50. ✅ **DONE (v1.35.0)** — **Self-service waitlist / virtual queue**: guests join online with a
    live position + ETA, get a "table ready" text when paged, and can leave the queue.
51. ✅ **DONE (v1.36.0)** — **Menu modifiers + combos**: option groups with price deltas + min/max;
    required groups = combos; server-priced and shown on tickets/receipts.
52. ✅ **DONE (v1.37.0)** — **Scheduled order-ahead + curbside**: future pickup/delivery times +
    curbside with vehicle and an "I'm here" arrival alert.
53. ✅ **DONE (v1.38.0)** — **Reservation deposits + guest CRM**: configurable deposit (card hold)
    for larger parties with staff refund; searchable Guests CRM with VIP/tags/notes + history.
54. ✅ **DONE (v1.39.0)** — **Promo codes + gift cards**: %/$ codes (min/limit/window/location) applied
    at online checkout; buyable stored-value gift cards with balances, ledger, and redemption.

---

## Conditional (impact depends on scale — defer until you outgrow a single server)
- **PostgreSQL migration** (SQLite → Postgres) and **Redis pub/sub** for the WebSocket bus across
  multiple instances.
- **Accessibility (WCAG)**, **i18n / multi-currency**, **GDPR data-deletion** workflows — high
  impact *if* you expand to regulated or international markets.

---

## Suggested starting sequence
1. ✅ Tier-1 quick wins (#1–#4) — **done in v1.9.0**.
2. ✅ **#20 (chef 86-ing)** + **#43 (auto-depletion)** — **done in v1.9.0**; closed the single
   biggest operational gap.
3. ✅ Tier-5 **#44 (notifications)** + **#45 (online ordering)** — **done in v1.10.0**.
4. ✅ **#35 (QR ordering)** + **#37 (accounts/loyalty)** + **#38 (email marketing)** — **done in v1.11.0**.
5. ✅ **Loyalty redemption** + **two-way/broadcast staff messaging** — **done in v1.12.0**.
6. ✅ **Configurable permissions** + **discounts/comps/voids** + **loyalty tiers/referrals** — **done in v1.13.0**.
7. ✅ **Split-the-bill** + **Tier-1 polish** (menu allergens/photos + dietary filter, ticket
   allergen flags, receipt feedback) — **done in v1.14.0**.
8. ✅ **Table transfer/merge** + **waste tracking** + **approvals dashboard** — **done in v1.15.0**.
9. ✅ **Vendor records** + **self-service My Pay** + **course tagging/grouping** — **done in v1.16.0**.
10. ✅ **Order edit** (add/remove items with re-depletion + audit) — **done in v1.17.0**.
11. ✅ **Cycle counts** + **per-employee performance** + **certification tracking** — **done in v1.18.0**.
12. ✅ **Waitlist** + **SKU/scan-to-receive** + **inventory valuation & COGS** — **done in v1.19.0**.
13. ✅ **Staff scheduling backend + UI** — **done in v1.20.0** (unblocks shift swapping).
14. ✅ **Shift swapping** (offer → claim → owner/manager approval) — **done in v1.21.0**.
15. ✅ **Expiry / lot (FIFO) tracking** — **done in v1.22.0**.
16. ✅ **Regions + regional-manager role + cross-location staff lending** — **done in v1.23.0**.
17. ✅ **Central menu with per-location overrides** — **done in v1.24.0**.
18. **Next (remaining):** **2FA for owner/manager** — the last remaining backlog item.
