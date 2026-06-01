# Restaurant Management System — Enhancement Recommendations

**Companion to:** `DOCUMENTATION.md` (functional & technical reference)
**Status:** Advisory backlog
**Organization:** Ordered **ascending by impact** — Tier 1 (smallest) → Tier 5 (highest / transformational).

> ✅ **Delivered in v1.9.0:** #1 Refund UI · #2 Low-stock alerts (stockroom + chef) ·
> #3 Configurable tax/service-charge · #4 Stronger password policy + broader rate limiting ·
> #20 Chef "86" with live availability · #43 Inventory auto-depletion (recipes/BOM) + auto-86.
> ✅ **Delivered in v1.10.0:** #44 Operational + real-time notifications · #45 Online ordering
> (pickup/delivery, pay-on-collection).

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
| 🔴 1 | QR-code table ordering | Customer, Owner | 4 |
| 🟠 2 | Two-way / broadcast staff messaging | All staff | 2–3 |
| 🟠 3 | Customer accounts + loyalty + marketing email | Customer, Owner | 4 |
| 🟠 4 | Configurable roles/permissions + discounts/comps/voids | Owner, Manager | 3–4 |

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
24. **Waste/spoilage logging + expiry/lot (FIFO) tracking**. *M*
25. **Per-employee performance metrics** (sales/waiter, table-turn, tips). *M*
26. **Discounts / comps / voids** with approval + audit. *M*
27. **Shift swapping & availability** (R8). *M*
28. **Self-service staff portal** (view tips/pay, schedule, swaps). *M*
29. **Broadcast announcements** (manager/owner → staff). *M*
30. **Reservation reminders** + real-time availability + **waitlist** (R9). *M*
31. **Regional grouping + regional-manager role**; **cross-location staff lending**. *M*
32. **Central menu with per-location overrides**. *M*
33. **2FA for owner/manager** (R7). *M* — security-critical
34. **Inventory valuation & COGS** reporting. *M*

## Tier 4 — High impact
35. **QR-code table ordering** (R2). *M–L*
36. **Par levels + auto-reorder suggestions** (draft POs below threshold). *M–L*
37. **Customer accounts + loyalty + referrals** (R3). *L*
38. **Email marketing / promotions** (reuse email layer; **must add consent + unsubscribe**). *M–L*
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
    tracking, server-priced, kitchen-integrated, manager fulfillment panel. Pay-on-collection;
    online prepayment + delivery dispatch remain follow-ups.

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
3. **Next:** Tier-5 **#44 (operational/real-time notifications)** and **#45 (online ordering)** —
   the major revenue/efficiency bets. Then the remaining Tier-1 polish (#5–#9).
