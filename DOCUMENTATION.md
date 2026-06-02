# Restaurant Management System — Functional & Technical Documentation

**Version:** 1.18.0
**Document status:** Official reference
**Platform:** Web application (desktop + mobile responsive)

---

## 1. Executive Summary

The Restaurant Management System is a multi-location restaurant operations platform that
unifies staff management, time & attendance, floor and table operations, order processing,
menu management, table reservations, inventory & supply chain, and payroll reporting into a
single role-based web application.

It is designed for a restaurant group operating several locations under one ownership, with a
central owner, per-location managers, and front-line staff (waiters, chefs, front desk,
stockroom, and general employees). All data is segregated by location, with the owner holding
cross-location visibility.

Key characteristics:

- **Role-based access control** across 7 distinct roles.
- **Multi-location** data isolation with consolidated owner oversight.
- **Real-time updates** via WebSocket (orders, tables, reservations) — no manual refresh.
- **Full audit trail** of sensitive operations.
- **Responsive UI** with a dedicated mobile experience and light/dark themes.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Web framework | Express 4 |
| Real-time | `ws` (WebSocket server) |
| Database | SQLite (file-based, synchronous driver) |
| Authentication | JSON Web Tokens (`jsonwebtoken`) |
| Password security | `bcryptjs` (salted hashing) |
| Rate limiting | `express-rate-limit` |
| Configuration | `dotenv` |
| Cross-origin | `cors` |
| Frontend | Vanilla JavaScript, HTML5, CSS3 (no build step, no framework) |

**Scripts**

| Command | Purpose |
|---|---|
| `npm start` | Start the server (`node server.js`) |
| `npm run seed` | Reset and populate the database with demo data |

---

## 3. System Architecture

```
Browser (role-specific HTML page)
   │  REST (fetch + JWT)          │  WebSocket (live events)
   ▼                              ▼
Express app  ──────────────  HTTP server + ws server
   │
   ├─ Middleware: CORS, JSON parser, static file server
   ├─ Auth middleware: verifyToken, requireRole
   ├─ 21 route modules under /api/*
   ├─ lib/ws.js     → real-time broadcast bus
   ├─ lib/audit.js  → audit logging helper
   └─ SPA fallback + global error handler
   │
   ▼
SQLite database (33 tables)
```

- The server boots by validating `JWT_SECRET`, creating the schema (idempotent), mounting all
  routes, attaching the WebSocket server to the same HTTP listener, and serving the static
  frontend.
- The frontend is a set of role-specific pages served statically; each authenticates with a
  JWT stored in the browser and calls the REST API. Pages that benefit from live data open a
  WebSocket connection scoped to their location.

---

## 4. User Roles & Access Model

Seven roles are enforced both in the UI (page routing) and on the server (`requireRole`).

| Role | Scope | Primary responsibilities |
|---|---|---|
| **Owner** | All locations | Full oversight: staff, payroll, inventory, menu, reservations, audit log, cross-location reporting. |
| **Manager** | Own location | Run a single location: staff, schedule, timesheets, inventory, supply, transfers, floor plan, reservations, menu, approvals. |
| **Stockroom** | Own location | Inventory and supply-chain operations (uses the manager dashboard). |
| **Chef** | Own location | Kitchen order queue, inventory quick view. |
| **Waiter** | Own location | Assigned area, full floor, take/serve orders. |
| **Front Desk** | Own location | Floor map, table status, reservations. |
| **Employee** | Own location | Time clock, plus waiter-equivalent table/order capability. |

**Cross-cutting rules**

- Every role **except Owner** must clock in/out. Clock-in is **enforced**: non-owner staff
  cannot take orders, change table status, or settle bills while off the clock.
- All non-owner staff can act as a waiter (view all tables at their location, take orders,
  update table status).
- The Owner is the only role with multi-location visibility; all other roles are constrained
  to their assigned `location_id`.

---

## 5. Functional Requirements & Feature Modules

### 5.1 Authentication & Account Management
- **FR-1.1** Users log in with email + password; credentials verified against a bcrypt hash;
  only active accounts may sign in.
- **FR-1.2** Successful login issues a JWT (8-hour default expiry) carrying id, role,
  location, and name.
- **FR-1.3** Login is rate-limited to 10 attempts per IP per 15 minutes.
- **FR-1.4** Users are routed to a role-appropriate dashboard automatically; mobile-capable
  roles may use the mobile interface.
- **FR-1.5** Any user can update their own profile (name, email) and change their own
  password (current password required; minimum 8 characters). Password changes are
  rate-limited per user.
- **FR-1.6** Any user can **log out everywhere** — revoking every previously issued token
  while keeping the current device signed in. Changing a password, resetting a password, and
  account deactivation also revoke all existing sessions immediately.

### 5.2 Staff Management
- **FR-2.1** Owners manage staff across all locations; managers manage staff within their own
  location only and cannot create owner accounts.
- **FR-2.2** Create, edit, and deactivate employees, including role, location, and hourly
  rate.
- **FR-2.3** Deactivation is a soft delete (account disabled and email anonymized) to preserve
  historical records; the last active owner cannot be deactivated.
- **FR-2.4** Live "on duty" view of currently clocked-in staff.
- **FR-2.5** **Certifications** — owners/managers record per-employee certifications (e.g., food
  handler) with issue/expiry dates; the UI highlights expired and soon-to-expire ones.

### 5.3 Time & Attendance
- **FR-3.1** All non-owner staff clock in and out; a topbar clock widget is available on every
  staff page, and the Employee portal provides a full clock console.
- **FR-3.2** The system prevents double clock-in and computes hours worked automatically on
  clock-out.
- **FR-3.3** Employees view their weekly hours with week-by-week navigation.
- **FR-3.4** Floor operations require an active clock-in: non-owner staff are blocked
  (HTTP 403) from creating/advancing orders, changing table status, or settling bills unless
  they are on the clock. The Owner is exempt. Structural/admin actions (floor-plan edits,
  staff management, menu, etc.) are not gated.
- **FR-3.5** **Task hand-off on clock-out.** When a staff member clocks out, their unfinished
  work (open, unpaid orders and area assignments) is automatically reassigned to the
  least-loaded on-duty colleague at the same location. If no colleague is on duty, the orders
  stay assigned (preserving tip/payroll attribution) and the Owner is notified — both an
  in-app message and an email — to arrange coverage.

### 5.4 Floor, Areas & Tables
- **FR-4.1** Each location is divided into areas (e.g., Main Hall, Patio, Bar, Private
  Dining), each with tables of defined capacity.
- **FR-4.2** Tables carry one of ten live statuses (empty, occupied, ready to order, ordered,
  waiting food, needs help, waiting to pay, special request, ready to clean, cleaning).
- **FR-4.3** Managers/owners manage the floor plan (create/edit/delete areas and tables);
  front-line staff update table statuses.
- **FR-4.4** Waiters can be assigned to areas; assignments drive each waiter's "My Area" view.
- **FR-4.5** Table status changes broadcast in real time to all connected clients at that
  location.
- **FR-4.6** **Transfer & merge** — an open order can be moved to another table (transfer), and
  all of a table's open orders can be merged into another table. Table statuses update
  automatically (freed tables return to empty), changes broadcast, and the action is audited.

### 5.5 Order Processing
- **FR-5.1** Waiters, managers, and all non-owner staff can take orders against a table.
- **FR-5.2** Orders are composed from the priced menu via a quick-pick menu picker, or entered
  manually; each line has item, quantity, and price.
- **FR-5.3** Every order supports a **special request** (e.g., allergies, preferences), stored
  with the order and surfaced to the kitchen and waiter.
- **FR-5.4** Orders progress through pending → preparing → ready → served; marking served
  returns the table to "ready to clean".
- **FR-5.5** The kitchen queue shows live orders with elapsed time and urgency flags, and
  updates in real time as orders are placed or advanced.
- **FR-5.6** **Void** — permitted staff can void an unpaid order with a reason; voided orders
  leave the active views, their auto-depleted inventory is restored, the table is freed, and
  the action is audited. A paid order cannot be voided (refund instead).
- **FR-5.7** **Courses** — each order item is tagged with a course (derived from its menu
  category: Appetizers/Mains/Desserts/Drinks); the kitchen queue groups a ticket's items by
  course for clearer prep/firing.
- **FR-5.8** **Order edit** — staff can add items, change quantities, and remove items on an
  order until it has a payment; inventory re-depletes or restocks the delta (with auto-86), and
  each change is audited. Editing is blocked once any payment exists, or if the order is voided.

### 5.6 Menu Management & Pricing
- **FR-6.1** Owners and managers maintain a per-location menu of categories and priced items.
- **FR-6.2** Items carry name, description, price, and availability; availability can be
  toggled without deletion.
- **FR-6.3** The menu drives order pricing through the order-taking menu picker.
- **FR-6.4** Chefs can mark an item out of stock ("86") and back on from the Chef Station;
  waiters and chefs may only toggle availability, not edit prices or structure.
- **FR-6.5** Each item can carry a **recipe** (bill of materials) mapping it to inventory
  items and per-serving quantities, maintained by owners/managers. Recipes drive automatic
  inventory depletion and auto-86 (see FR-8.6).
- **FR-6.6** Items can carry a **photo**, **allergens**, and **dietary** tags
  (vegetarian/vegan/gluten-free), shown on the public menu/ordering pages (with a dietary
  filter) and surfaced as allergen flags on kitchen tickets.

### 5.7 Reservations
- **FR-7.1** Owners, managers, and front desk create and manage reservations (guest name,
  contact, party size, date, time, optional table and notes).
- **FR-7.2** Reservations follow a lifecycle: pending → confirmed → seated → completed, with
  no-show and cancelled terminal states.
- **FR-7.3** Reservations are filterable by location (owner), date, and status; changes
  broadcast in real time.

### 5.8 Inventory & Supply Chain
- **FR-8.1** Per-location inventory with quantity, unit, category, and minimum threshold.
- **FR-8.2** A consolidated warehouse view compares stock across all locations.
- **FR-8.3** Supply orders to vendors with status tracking (pending → approved → shipped →
  received); receiving increments stock and records a transaction.
- **FR-8.4** Inter-location transfer requests and immediate transfers, with stock validation
  (insufficient stock is rejected) and full transaction logging.
- **FR-8.5** Managers and stockroom staff see a **low-stock alert** banner listing items below
  their minimum threshold, with critical items highlighted; the Chef Station shows the same
  low-stock alert.
- **FR-8.6** **Automatic inventory depletion.** When an order is placed, each item's recipe
  ingredients are deducted from that location's inventory and logged as transactions (clamped
  at zero). Any menu item whose ingredients can no longer cover one serving is automatically
  marked unavailable ("auto-86").
- **FR-8.7** **Waste/spoilage logging** — owners, managers, stockroom, and chefs can write off
  stock with a reason; the quantity is deducted, logged to a waste log + transaction ledger,
  and audited.
- **FR-8.8** **Vendor master records** — owners/managers maintain a vendor list (contact, phone,
  email, lead time); supply orders can be placed against a vendor, and vendor names appear on
  the supply-order history.
- **FR-8.9** **Cycle counts** — staff reconcile an item to a physically-counted quantity; the
  variance is recorded, stock is updated to the count, and an adjustment transaction is logged.

### 5.9 Scheduling
- **FR-9.1** Weekly staff schedules per location (work date, shift start/end).

### 5.10 Payroll & Timesheets
- **FR-10.1** Owners and managers generate timesheet reports over a date range (and by
  location for owners).
- **FR-10.2** Reports compute gross pay, a 10% tax deduction, a 5% benefit deduction, and net
  pay (85%) per employee, with totals.
- **FR-10.3** Tips collected at bill settlement are attributed to the serving employee and
  reported per employee, with a take-home figure (net wages + tips) and grand totals.
- **FR-10.4** Reports are printable and exportable to CSV.
- **FR-10.5** **Self-service pay** — any staff member can see their own hours, gross/net pay, and
  tips for the last 7 days from Account Settings → My Pay.

### 5.11 Time Off Requests
- **FR-11.1** Any employee submits time-off requests (vacation, sick, personal, other) with a
  date range and reason.
- **FR-11.2** Managers approve/deny requests for their location; owners across all locations;
  reviewers may attach a note.
- **FR-11.3** Employees can cancel their own pending requests and track status.
- **FR-11.4** **Consolidated approvals** — owners and managers see a dashboard card summarizing
  everything awaiting action (pending time-off, transfer requests, and supply orders) with
  one-click links to the relevant review screens.

### 5.12 Internal Messaging & Feedback
- **FR-12.1** Employees send messages/feedback addressed to their manager, the owner, or both.
- **FR-12.2** Managers see messages for their location; owners see all messages across
  locations; messages can be marked read.
- **FR-12.3** A topbar notification bell shows the unread message count and links to the inbox.
- **FR-12.4** **Threaded replies** — owners/managers can reply to an employee's message; the
  sender sees the reply thread on their own messages view (two-way conversation).
- **FR-12.5** **Broadcast announcements** — owners/managers post announcements to staff (own
  location, or all locations for owners). They appear in staff message views and are pushed
  live as real-time toasts (FR-14.2).

### 5.13 Audit Log
- **FR-13.1** Sensitive operations (e.g., reservation create/update, menu changes, order
  lifecycle) are recorded with actor identity, role, location, entity, and details.
- **FR-13.2** Owners review the audit log across all locations; managers see their own
  location. The log is filterable by action.

### 5.14 Real-Time Updates
- **FR-14.1** Order, table, and reservation changes are pushed over WebSocket to all relevant
  clients at the affected location, keeping kitchen, floor, and front-desk views current
  without polling.
- **FR-14.2** **Operational notifications** are pushed as on-screen toasts to the relevant
  roles: order-ready (→ front-of-house), table needs help (→ managers/servers), low-stock
  crossings (→ managers/stockroom/chef), and new online orders (→ kitchen/managers).
- **FR-14.3** **Reservation reminders** — a background check notifies front desk/managers of
  confirmed reservations starting within the next 30 minutes (each reminded once).

### 5.15 Presentation & Accessibility
- **FR-15.1** Responsive layout with a hamburger-driven sidebar on small screens and a
  dedicated mobile interface for field roles.
- **FR-15.2** Light/dark theme toggle persisted per browser.

### 5.16 Payments & Bill Settlement
- **FR-16.1** Order-handling staff settle a table's bill, producing an itemized total of
  subtotal + optional service charge + sales tax + optional tip. The sales-tax and
  service-charge rates are owner-configurable in-app (Sales Analytics → Tax & Service Charge),
  falling back to the `SALES_TAX_RATE` env default when unset.
- **FR-16.2** Tips can be selected by quick percentage (15/18/20%) or entered manually, and
  are recorded against the serving employee for payroll.
- **FR-16.3** Payment method may be card, cash, or mobile. Card payments use Stripe when
  configured (real test/live card flow via Stripe.js); without Stripe keys the system runs in
  a simulated record-only mode so all totals, tips, and reporting still function.
- **FR-16.4** Settling a bill marks the order served and the table ready-to-clean; a paid
  order cannot be paid twice. Once paid, the UI reflects this: the payment dialog's **Charge**
  action is disabled and relabeled **Paid**, and the order's "Settle Bill" button becomes a
  disabled **✓ Paid** indicator.
- **FR-16.5** Owners and managers can view payment history and **refund** a paid payment
  directly from the Payments & Refunds table (under Sales Analytics).
- **FR-16.6** **Loyalty redemption** — when an order is linked to a customer account, staff can
  redeem the customer's points at settlement (20 points = $1) for a discount, capped at the
  bill and the customer's balance; points are deducted and logged. (Direct-payment path; Stripe
  card prepay redemption is a follow-up.)
- **FR-16.7** **Discounts & comps** — permitted staff can apply a manual discount (or "Comp
  100%") with a reason at settlement; it is stored on the payment, shown on the receipt, and
  audited.
- **FR-16.8** **Configurable permissions** — the owner controls which roles may refund, void,
  and discount (Sales Analytics → Staff Permissions). Enforced server-side; the owner is always
  permitted. The UI shows these controls only to permitted staff.
- **FR-16.9** **Split the bill** — a bill can be settled by multiple partial payments (by
  subtotal portion, with proportional tax/service and per-payment tips); the order settles and
  loyalty is earned only once the full subtotal is covered. The payment dialog offers ½/⅓/¼/Full
  splits. (Discounts/redemption apply only to a single full payment.)

### 5.17 Customer-Facing Site (Public)
- **FR-17.1** Anyone can browse a location's menu (categories and available, priced items)
  without logging in.
- **FR-17.2** Anyone can submit an online reservation request (name, contact, party size,
  date, time, notes); requests are created as **pending** for staff confirmation and are
  rate-limited to deter abuse.
- **FR-17.3** The public pages are linked from the staff login screen and require no account.
- **FR-17.4** **Online ordering** — anyone can place a **pickup or delivery** order from a
  location's menu without logging in. Prices are taken from the server; the order enters the
  kitchen queue as a normal order (no table/waiter), inventory auto-depletes, and staff are
  notified. The customer gets a **tracking code** to follow status (received → preparing →
  ready → completed) and an email confirmation. Payment is collected by staff at
  collection/handoff (online prepayment is a planned follow-up).
- **FR-17.5** **QR-code table ordering** — each table has a QR code (printable from the manager
  Floor Plan) that opens the menu in "table mode"; guests order **dine-in** straight to the
  kitchen, the table flips to *ordered*, and a server settles the bill as usual.
- **FR-17.6** **Customer accounts & loyalty** — customers can register/sign in (separate from
  staff), view order history, and earn **1 loyalty point per $1** on paid orders linked to their
  account (online or QR while signed in). Points and a ledger are shown in their account, along
  with their **tier** (Bronze/Silver/Gold by lifetime points) and progress to the next tier.
- **FR-17.8** **Referrals** — each customer has a referral code; entering a friend's code at
  sign-up awards both members a bonus (50 points each).
- **FR-17.9** **Post-visit feedback** — the digital receipt page invites a 1–5 star rating and
  comment; submissions are visible to owners/managers (with an average) under Sales Analytics.
- **FR-17.7** **Email marketing** — owners send campaigns to customers who opted in; every
  email carries a one-click **unsubscribe** link. Opt-in is captured at registration and is
  toggleable in the account; unsubscribing is honored immediately.

### 5.18 Sales & Revenue Analytics
- **FR-18.1** Owners and managers view a sales analytics dashboard over a selectable date
  range (with 7/30/90-day quick ranges).
- **FR-18.2** Headline KPIs: total revenue, paid orders, average ticket, and tips collected.
- **FR-18.3** Visual breakdowns: revenue trend by day, top-selling items, and a
  payment-method split.
- **FR-18.4** Owners additionally see revenue broken down by location; managers are scoped to
  their own location.
- **FR-18.5** **Per-employee performance** — a breakdown by serving staff (orders, sales, average
  ticket, tips) over the selected range.

### 5.19 Notifications & Self-Service (Email)
- **FR-19.1** A shared email layer sends transactional messages via SMTP when configured, or
  records them to an email log in simulated mode otherwise — so all flows work without setup.
- **FR-19.2** Guests who provide an email receive a **reservation confirmation** with a code,
  and can **look up or cancel** their reservation using that code plus their email/phone.
- **FR-19.3** A **digital receipt** is generated for every settled bill, emailable to the guest
  and viewable/printable at a public receipt page via its receipt code.
- **FR-19.4** Users can request a **password reset**; a one-time, expiring link is emailed and
  consumed on the reset page. Requests never reveal whether an email is registered.

---

## 6. Role × Capability Matrix

| Capability | Owner | Manager | Stockroom | Chef | Waiter | Front Desk | Employee |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Clock in/out | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| View tables / take & serve orders | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Update table status | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Kitchen order queue | ✓ | ✓ | — | ✓ | — | — | — |
| Reservations | ✓ | ✓ | — | — | — | ✓ | — |
| Menu management | ✓ | ✓ | — | — | view/avail | — | — |
| Staff management | ✓ | ✓ (own loc) | — | — | — | — | — |
| Timesheets / payroll | ✓ | ✓ (own loc) | — | — | — | — | — |
| Settle bill / take payment | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Refund payment / payment history | ✓ | ✓ (own loc) | — | — | — | — | — |
| Sales analytics | ✓ (all) | ✓ (own loc) | — | — | — | — | — |
| Inventory & supply | ✓ | ✓ | ✓ | view | — | — | — |
| Transfers | ✓ | ✓ | ✓ | — | — | — | — |
| Approve time off | ✓ (all) | ✓ (own loc) | — | — | — | — | — |
| Submit time off / messages | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read staff messages | ✓ (all) | ✓ (own loc) | — | — | — | — | — |
| Audit log | ✓ (all) | ✓ (own loc) | — | — | — | — | — |
| Multi-location visibility | ✓ | — | — | — | — | — | — |

*Note: the public menu and reservation-request pages require no role at all (unauthenticated guests).*

---

## 7. Data Model

SQLite database with 33 tables. Core entities and relationships:

> **Entity-relationship overview.** `locations` is the hub: `users`, `areas`, `tables`,
> `orders`, `inventory`, `reservations`, `menu_categories/items`, and `payments` all carry a
> `location_id`. `orders` → `order_items` (1-to-many) and `orders` → `payments` (1-to-1 when
> settled). `users` are referenced by `clock_records`, `orders.waiter_id`,
> `time_off_requests`, `employee_messages`, `audit_log`, and `password_reset_tokens`.
> `menu_categories` → `menu_items` (1-to-many). All child rows reference parents by foreign key.

- **locations** — restaurant branches.
- **users** — staff accounts (role enum, location FK, hourly rate, active flag).
- **clock_records** — check-in/out events and computed hours.
- **areas** / **tables** — floor layout; tables belong to areas and locations.
- **waiter_assignments** — waiter ↔ area mapping (unique pair).
- **orders** / **order_items** — orders per table (status enum, notes/special request) and
  their line items (name, qty, price, notes). `table_id` is nullable; online orders carry
  `order_type` (dine_in/pickup/delivery), customer contact, delivery address, and a tracking code.
- **menu_categories** / **menu_items** — per-location menu with pricing and availability.
- **reservations** — guest bookings with lifecycle status.
- **inventory** / **inventory_transactions** — stock and movement ledger.
- **supply_orders** — vendor orders with status and shipping details.
- **transfer_requests** — inter-location stock transfers.
- **schedules** — weekly shifts.
- **time_off_requests** — leave requests with review workflow.
- **employee_messages** — internal messaging/feedback.
- **audit_log** — immutable record of sensitive actions.
- **payments** — bill settlement per order: subtotal, service charge, tax, tip, total, method
  (card/cash/mobile), status (pending/paid/refunded/failed), Stripe intent reference, receipt
  code/email, and the processing employee. Reservations also carry a public confirmation code.
- **email_log** — every outbound notification (sent or simulated) for auditability.
- **password_reset_tokens** — one-time, expiring tokens backing the self-service password reset.
- **settings** — global key/value configuration (e.g., sales-tax and service-charge rates).
- **recipes** — bill-of-materials mapping `menu_items` → `inventory` with per-serving
  quantities; drives auto-depletion and auto-86.
- **customers** — customer accounts (separate from staff `users`): email/password, loyalty
  points, marketing opt-in, and an unsubscribe token. Orders may reference `customer_id`.
- **loyalty_transactions** — points ledger (earned per paid order, or redeemed for a discount) per customer.
- **announcements** — broadcast notices from owner/manager to staff (location-scoped or global).
- **permissions** — configurable capability×role grants (refund/void/discount) the owner manages.
- **feedback** — post-visit guest ratings (1–5) + comments, tied to a receipt.
- **waste_log** — stock written off (quantity + reason + actor) for spoilage/loss tracking.
- **vendors** — supplier master records (contact, lead time); `supply_orders.vendor_id` links them.
- **cycle_counts** — physical inventory counts (system vs counted qty + variance).
- **certifications** — staff certifications with issue/expiry dates.
- **order_items** also carry a `course` (Appetizers/Mains/Desserts/Drinks) for kitchen grouping.
- **menu_items** also carry `image_url`, `allergens`, and `dietary` tags.
- **employee_messages** carries `parent_id` for threaded replies; **payments** carries
  `discount` (loyalty), `manual_discount` + `discount_reason` (comps); **orders** carries
  `voided` + `void_reason`; **customers** carry `referral_code` + `referred_by`.

Referential integrity is enforced with foreign keys; status fields use CHECK constraints;
emails are unique. Schema creation and lightweight column migrations run automatically on
startup.

---

## 8. REST API Reference

All endpoints are under `/api`. Except `POST /auth/login`, every endpoint requires a valid
`Authorization: Bearer <token>` header. Role restrictions are enforced server-side.

### Authentication — `/api/auth`
| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/login` | Public (rate-limited) | Authenticate; returns token + user. |
| GET | `/me` | Any | Current user profile. |
| PUT | `/profile` | Any | Update own name/email. |
| PUT | `/password` | Any | Change own password. |
| POST | `/forgot-password` | Public (rate-limited) | Email a reset link; always returns generic success (no account enumeration). |
| POST | `/reset-password` | Public (rate-limited) | Set a new password using a valid, unused, unexpired token; revokes existing sessions. |
| POST | `/logout-all` | Any | Revoke all of this user's tokens ("log out everywhere"); returns a fresh token so the current device stays signed in. |

### Employees — `/api/employees`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager | List staff (by location; managers own location). |
| GET | `/all` | Owner | All users including owners. |
| GET | `/on-duty` | Owner, Manager | Currently clocked-in staff. |
| GET | `/:id` | Owner, Manager | Employee detail. |
| POST | `/` | Owner, Manager | Create employee. |
| PUT | `/:id` | Owner, Manager | Update employee. |
| DELETE | `/:id` | Owner | Soft-delete employee. |
| GET · POST | `/:id/certifications` | Owner, Manager | List / add an employee's certifications. |
| DELETE | `/:id/certifications/:certId` | Owner, Manager | Remove a certification. |

### Time Clock — `/api/clock`
| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/in` | Any | Clock in. |
| POST | `/out` | Any | Clock out (computes hours); hands off open orders/areas to an on-duty colleague or alerts the owner. |
| GET | `/status` | Any | Current clock status. |
| GET | `/hours` | Any | Weekly hours (self or queried user). |
| GET | `/recent` | Any | Last 20 clock events. |

### Areas — `/api/areas`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | All staff | Areas with table counts and waiters. |
| GET | `/assignments` | Owner, Manager | Waiter→area assignments. |
| POST | `/assignments` | Owner, Manager | Assign waiter to area. |
| DELETE | `/assignments/:id` | Owner, Manager | Remove assignment. |
| POST | `/` | Owner, Manager | Create area. |
| PUT | `/:id` | Owner, Manager | Update area. |
| DELETE | `/:id` | Owner, Manager | Delete area. |

### Tables — `/api/tables`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | All staff | Tables with area/waiter info. |
| GET | `/by-area` | All staff | Tables grouped by area. |
| POST | `/` | Owner, Manager | Create table. |
| PUT | `/:id` | All staff (metadata: Owner/Manager) | Update status/metadata; broadcasts. |
| DELETE | `/:id` | Owner, Manager | Delete table. |

### Orders — `/api/orders`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | All non-owner staff + Owner | Orders for location (optional status filter). |
| POST | `/` | Waiter, Manager, Employee, Chef, Front Desk, Stockroom | Create order with items + special request; broadcasts; audited. |
| PUT | `/:id` | Same as POST + Owner | Advance status; broadcasts; audited. |
| PUT | `/:id/void` | On-duty staff with `void` permission | Void an unpaid order (reason); restores inventory; audited. |
| PUT | `/:id/move` | On-duty floor staff | Move an order to another table (transfer). |
| PUT | `/merge` | On-duty floor staff | Merge a table's open orders into another table. |
| POST | `/:id/items` | On-duty staff | Add an item to an unpaid order (re-depletes inventory). |
| PUT | `/:id/items/:itemId` | On-duty staff | Change a line's quantity (adjusts inventory by the delta). |
| DELETE | `/:id/items/:itemId` | On-duty staff | Remove a line (restocks inventory). |

### Inventory — `/api/inventory`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager, Chef, Stockroom | Inventory for location. |
| GET | `/warehouse` | Owner, Manager, Stockroom, Chef | All-locations stock comparison. |
| GET | `/supply-orders` | Owner, Manager, Stockroom, Chef | Supply orders. |
| POST | `/order` | Owner, Manager, Chef, Stockroom, Employee | Create supply order. |
| PUT | `/order/:id` | Owner, Manager | Update supply status; receiving adds stock. |
| GET | `/transfer-requests` | Owner, Manager, Stockroom, Chef | Transfer requests. |
| POST | `/transfer-request` | Owner, Manager, Stockroom, Chef, Employee | Create transfer request. |
| PUT | `/transfer-request/:id` | Owner, Manager, Stockroom | Update transfer (stock-validated). |
| POST | `/transfer` | Owner, Manager, Stockroom | Immediate transfer. |
| GET | `/transactions` | Owner, Manager, Stockroom | Last 100 transactions. |
| POST | `/waste` | Owner, Manager, Stockroom, Chef | Write off stock (quantity + reason); deducts inventory + logs. |
| GET | `/waste` | Owner, Manager, Stockroom, Chef | Recent waste entries (location-scoped). |
| GET | `/vendors` | Owner, Manager, Stockroom, Chef | Active vendor list. |
| POST · PUT · DELETE | `/vendors[/:id]` | Owner, Manager | Create / edit / deactivate a vendor. |
| POST | `/count` | Owner, Manager, Stockroom, Chef | Cycle count an item (records variance + adjustment). |
| GET | `/counts` | Owner, Manager, Stockroom, Chef | Recent cycle counts (location-scoped). |

### Locations — `/api/locations`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Any | List locations. |
| GET | `/summary` | Any | Per-location KPIs + global totals. |

### Timesheets — `/api/timesheets`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager | Payroll report (gross, tax 10%, benefit 5%, net, plus tips and take-home). |
| GET | `/me` | Any staff | The caller's own hours, gross/net pay, and tips for a date range (default 7 days). |

### Time Off — `/api/time-off`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Any (scoped by role) | Requests (own / location / all). |
| POST | `/` | Any | Submit request. |
| PUT | `/:id` | Owner/Manager (review), owner of request (cancel) | Approve/deny/cancel. |

### Messages — `/api/messages`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager | Inbox (owner: all; manager: own location). |
| GET | `/mine` | Any | Own sent messages. |
| POST | `/` | Any | Send message. |
| POST | `/:id/reply` | Owner, Manager | Reply to a message (threaded; visible to the sender). |
| PUT | `/:id/read` | Owner, Manager | Mark read. |
| DELETE | `/:id` | Owner/Manager or author | Delete (and its replies). |

### Announcements — `/api/announcements`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Any staff | Announcements for the caller's location + global (owners see all). |
| POST | `/` | Owner, Manager | Post an announcement (manager: own location; owner: a location or global) — pushes a live toast. |
| DELETE | `/:id` | Owner, Manager | Remove an announcement (manager limited to own location). |

### Reservations — `/api/reservations`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager, Front Desk | Reservations (filter by location/date/status). |
| POST | `/` | Owner, Manager, Front Desk | Create; broadcasts; audited. |
| PUT | `/:id` | Owner, Manager, Front Desk | Update/lifecycle; broadcasts; audited. |
| DELETE | `/:id` | Owner, Manager | Delete. |

### Menu — `/api/menu`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/categories` | Any | Categories for location. |
| POST | `/categories` | Owner, Manager | Create category. |
| PUT | `/categories/:id` | Owner, Manager | Update category. |
| DELETE | `/categories/:id` | Owner, Manager | Delete category + items. |
| GET | `/items` | Any | Items for location (optional category). |
| POST | `/items` | Owner, Manager | Create item. |
| PUT | `/items/:id` | Owner, Manager (full); Waiter, Chef (availability only) | Update item / toggle availability ("86"). |
| DELETE | `/items/:id` | Owner, Manager | Delete item (and its recipe). |
| GET | `/items/:id/recipe` | Owner, Manager, Chef | Item's ingredient list with current stock. |
| PUT | `/items/:id/recipe` | Owner, Manager | Replace the item's recipe (ingredients + quantities). |

### Audit — `/api/audit`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager | Audit entries (scoped by role; action filter). |

### Payments — `/api/payments`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/config` | Any staff | Returns Stripe status/key, sales-tax & service-charge rates, and the caller's capabilities (`can_discount/refund/void`). |
| GET | `/order/:orderId` | Order-handling staff | Itemized bill (items, subtotal, service charge, tax) + any existing payment. |
| GET | `/` | Owner, Manager | Payment history for a location. |
| POST | `/` | Order-handling staff | Record a cash/mobile (or simulated card) payment. Accepts `amount` (subtotal portion) for split bills, and `redeem_points`/`manual_discount` (single full payment only). Settles + earns loyalty once fully covered. |
| POST | `/intent` | Order-handling staff | Create a Stripe PaymentIntent for card payment. |
| POST | `/:id/confirm` | Order-handling staff | Confirm a card payment after the client completes the Stripe flow. |
| POST | `/:id/refund` | Staff with `refund` permission | Refund a paid payment. |

### Public (customer-facing, no authentication) — `/api/public`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/locations` | Public | Active locations (name, address, phone). |
| GET | `/menu` | Public | Available menu (categories + items with prices) for a location. |
| POST | `/reservations` | Public (rate-limited) | Submit an online reservation request; created as **pending**, returns a confirmation code, emails the guest. |
| GET | `/reservations/lookup` | Public | Look up a reservation by confirmation code + matching email/phone. |
| POST | `/reservations/cancel` | Public | Cancel a reservation by confirmation code + matching email/phone. |
| POST | `/order` | Public (rate-limited) | Place a dine-in (QR), pickup, or delivery order (server-priced); links the customer if signed in; returns a tracking code. |
| GET | `/order` | Public | Track an online order by tracking code (status + items). |
| POST | `/account/register` · `/account/login` | Public (rate-limited) | Customer sign-up / sign-in; returns a customer JWT. |
| GET | `/account/me` · `/account/orders` · `/account/loyalty` | Customer | Profile, order history, and points + ledger. |
| PUT | `/account/preferences` | Customer | Toggle marketing opt-in. |
| POST | `/unsubscribe` | Public | One-click unsubscribe via emailed token. |
| POST | `/feedback` | Public (rate-limited) | Submit a 1–5 rating + comment for a receipt code. |
| GET | `/receipt` | Public | View an itemized digital receipt by receipt code. |

### Analytics — `/api/analytics`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager | Sales analytics for a date range: KPIs (revenue, paid orders, avg ticket, tips), revenue by day, payment-method split, top-selling items, and revenue by location (owner, all-locations view). Managers are scoped to their own location. |
| GET | `/staff` | Owner, Manager | Per-employee performance (orders, sales, avg ticket, tips) for a range. |

### Settings — `/api/settings`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager | Current sales-tax and service-charge rates. |
| PUT | `/` | Owner | Update sales-tax and/or service-charge rates (fractions, 0–1). |
| GET | `/permissions` | Owner | Capability×role permission matrix (refund/void/discount). |
| PUT | `/permissions` | Owner | Grant/revoke a capability for a role. |

### Feedback — `/api/feedback`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager | Guest feedback (count + average + items), location-scoped for managers. |

### Marketing — `/api/marketing`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/audience` | Owner | Counts of total and opted-in customers. |
| GET | `/history` | Owner | Recent campaigns (from the email log). |
| POST | `/send` | Owner | Send a campaign to all opted-in customers (adds an unsubscribe footer). |

### Real-Time Events (WebSocket)
Clients connect to the server's WebSocket endpoint and send `{ type: "auth", location_id }`
to scope their subscription. The server broadcasts:

| Event | Trigger |
|---|---|
| `order_update` | Order created or status changed. |
| `notify` | Operational alert (order-ready, needs-help, low-stock, new online order, reservation reminder); client shows a role-targeted toast. |
| `table_update` | Table status changed. |
| `reservation_update` | Reservation created or updated. |

---

## 9. Frontend Application Map

| Page | Audience | Key areas |
|---|---|---|
| `index.html` | All | Login, theme toggle, links to public menu / reservation, mobile entry. |
| `menu.html` | Public (customers) | Browse any location's priced menu; no login. |
| `reserve.html` | Public (customers) | Submit an online reservation request (returns a confirmation code); no login. |
| `reserve-lookup.html` | Public (customers) | Look up or cancel a reservation by code + contact; no login. |
| `order.html` | Public (customers) | Order online: browse, cart, submit, track by code. Pickup/delivery, or "table mode" (`?table=`) for QR dine-in ordering. Links a signed-in customer for loyalty. |
| `account.html` | Public (customers) | Customer sign-up/sign-in, loyalty points, order history, marketing preference. |
| `unsubscribe.html` | Public (customers) | One-click marketing unsubscribe via emailed token. |
| `receipt.html` | Public (customers) | View/print an itemized receipt by receipt code; no login. |
| `reset.html` | Public | Set a new password from an emailed reset link. |
| `owner.html` | Owner | Overview, Staff & Locations, Timesheets, Warehouse, Supply, Transfers, Floor Plan, Admin Panel, Reservations, Menu (with recipe editor), Sales Analytics (incl. Tax & Service Charge settings and Payments & Refunds), Audit Log, Time Off, Messages, Marketing. |
| `manager.html` | Manager / Stockroom | Staff, Schedule, Timesheets, Inventory, Warehouse, Supply, Transfers, Floor Plan (incl. printable table QR codes), Reservations, Menu, Sales Analytics (incl. Payments & Refunds), Time Off, Messages; low-stock banner; Online Orders panel; live toasts. |
| `waiter.html` | Waiter | My Area, Full Floor, My Orders; take/serve with menu picker + special request; Settle Bill. |
| `chef.html` | Chef | Kitchen queue (dine-in + online pickup/delivery), inventory quick view, low-stock alert, Menu Availability (86/un-86), and live toasts. |
| `frontdesk.html` | Front Desk | Floor Map, Areas & Staff, Reservations. |
| `employee.html` | Employee | My Time (clock), Tables & Orders (take orders, Settle Bill), Time Off, Messages. |
| `mobile.html` | Field roles | Floor, My Area, Orders, Profile (clock) — touch-optimized. |

A **shared payment modal** (in `utils.js`) handles bill settlement across the waiter and
employee pages: itemized totals, tip selection, payment method, and the Stripe card field when
configured.

Shared client modules:

- **`public/js/api.js`** — a single `API` client wrapping all REST endpoints, injecting the
  JWT and handling automatic logout on 401.
- **`public/js/utils.js`** — shared helpers: session/auth, sidebar and account-settings,
  date/time formatting, table-status registry, modal and alert utilities, theme and mobile
  sidebar handling, the topbar clock widget, and the WebSocket client with auto-reconnect.

---

## 10. Security

- **Authentication:** stateless JWT; tokens carry minimal claims and expire (default 8h).
- **Passwords:** stored only as bcrypt hashes; never returned by the API; minimum length 8.
- **Rate limiting:** login, password reset, and password change are throttled (password change
  is keyed per user so staff sharing a public IP aren't collectively locked out).
- **Authorization:** every protected route validates the token and, where applicable, the
  caller's role; location scoping prevents cross-location data access for non-owners.
  Sensitive actions (refund, void, discount) use an owner-configurable permission overlay
  enforced server-side (the owner is always permitted).
- **Login protection:** per-IP rate limiting on the login endpoint.
- **Secret hygiene:** the server refuses to start with a missing or known-weak `JWT_SECRET`.
- **CORS:** restricted to a configured origin.
- **SQL safety:** queries use parameter binding.
- **Error hygiene:** a global handler returns generic messages and logs details server-side.
- **Accountability:** the audit log records who changed what, and when.

---

## 11. Configuration & Deployment

**Environment variables**

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP/WebSocket port | 3000 |
| `JWT_SECRET` | Token signing secret (required; must not be the weak default) | — |
| `JWT_EXPIRES_IN` | Token lifetime | 8h |
| `ALLOWED_ORIGIN` | Permitted CORS origin | http://localhost:3000 |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_...`); enables live card processing. If unset, payments run in simulated record-only mode. | — |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (`pk_...`) used by the in-browser card form. | — |
| `SALES_TAX_RATE` | Fallback sales-tax rate used when no in-app rate is set (owners can override in Settings; service charge is in-app only). | 0.08 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | SMTP server for outbound email. If unset, email runs in simulated mode (logged to `email_log`, nothing sent). | — |
| `MAIL_FROM` | From address for outbound email. | Restaurant <no-reply@restaurant.local> |

**Run locally**

```
npm install
npm run seed     # first run: create and populate the database
npm start        # serves the app on http://localhost:3000
```

The database schema is created automatically on startup; `npm run seed` resets all data to the
demo dataset.

---

## 12. Demo Accounts

After seeding, the following representative accounts are available (26 users total across 5
locations and all roles):

| Role | Email | Password | Location |
|---|---|---|---|
| Owner | `owner@restaurant.com` | `owner123` | All locations |
| Manager | `manager@downtown.com` | `mgr123` | Downtown Bistro |
| Stockroom | `stock@uptown.com` | `stock123` | Uptown Grille |
| Chef | `chef@downtown.com` | `chef123` | Downtown Bistro |
| Waiter | `waiter@downtown.com` | `wait123` | Downtown Bistro |
| Waiter | `waiter2@downtown.com` | `wait123` | Downtown Bistro |
| Front Desk | `desk@downtown.com` | `desk123` | Downtown Bistro |
| Employee | `emp@downtown.com` | `emp123` | Downtown Bistro |

Additional managers, chefs, waiters, front-desk, and employees exist for the other locations
(Uptown Grille, Airport Terminal, Westside Kitchen, Harbor View).

A demo **customer** account (for online ordering, loyalty, and marketing) is also seeded:
`diner@example.com` / `diner123` (starts with 120 loyalty points, marketing opt-in on).

**Locations:** Downtown Bistro · Uptown Grille · Airport Terminal · Westside Kitchen ·
Harbor View.

---

## 13. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | API responses under typical load should return in < 300 ms; the kitchen and floor views refresh via WebSocket push (no polling) so on-screen latency for status changes is < 1 s. |
| **Concurrency** | Designed for a single restaurant group; the SQLite/WAL backend comfortably supports ~100–200 concurrent staff sessions per server instance. |
| **Availability** | Single-process Node server; target 99% uptime for internal use. Stateless JWT auth allows the process to restart without forcing re-login (until token expiry). |
| **Browser support** | Modern evergreen browsers (Chromium/Edge, Firefox, Safari). Responsive from 320 px (mobile) to desktop. |
| **Security** | All non-public endpoints require JWT; passwords bcrypt-hashed; login rate-limited; payment card data never touches the server (handled by Stripe). |
| **Maintainability** | Zero front-end build step; routes are modular under `routes/`; schema is idempotent and self-migrating. |
| **Observability** | Sensitive mutations recorded in the audit log; server errors logged server-side. |

## 14. Known Limitations

- **Database scale** — SQLite is a single file; suitable for a small chain, not for high-volume multi-server deployments. Migrate to PostgreSQL for horizontal scaling.
- **Real-time fan-out** — the WebSocket bus is in-process; running multiple server instances would require a shared pub/sub (e.g., Redis) for cross-instance broadcasts.
- **Payments** — card processing requires a configured Stripe key; without it the system runs in a simulated record-only mode (see §11).
- **Inventory vs. menu** — menu items now auto-deplete inventory via recipes (FR-8.6), but only
  items that have a recipe defined; items without a recipe do not affect stock.
- **Notifications** — in-app real-time toasts cover order-ready, table-help, low-stock, new
  online orders, and reservation reminders (FR-14.2/14.3); email covers reservation
  confirmations, receipts, online-order confirmations, and password resets. No SMS/push yet.
- **Online ordering** — pickup/delivery orders are **pay-on-collection**; online prepayment
  (public card flow) and a dedicated driver/delivery-dispatch workflow are not yet built.
- **Loyalty** — points accrue and **redeem** for discounts at settlement (direct-payment path).
  Redemption during a real Stripe card prepay, plus tiers/rewards, are follow-ups.
- **QR codes** — printable table QR images are generated via an external QR image service, so
  generating them needs internet at print time (the customer ordering flow itself is local).

## 15. Roadmap / Future Enhancements

The full, role-by-role enhancement backlog lives in **`RECOMMENDATIONS.md`**, organized
ascending by impact (Tier 1 smallest → Tier 5 transformational) with effort estimates. The
highlights below are grouped the same way.

**Delivered in 1.9.0:** refund UI; low-stock alerts to stockroom & chef; configurable
tax/service-charge; stronger password policy & broader rate limiting; chef "86" with live
availability; inventory auto-depletion (recipes/BOM).

**Delivered in 1.10.0:** operational + real-time notifications (toasts) and reservation
reminders; online ordering (pickup/delivery, pay-on-collection) with customer tracking and
staff fulfillment.

**Delivered in 1.11.0:** QR-code table ordering (dine-in); customer accounts with loyalty
points + order history; owner email-marketing campaigns with opt-in/unsubscribe.

**Delivered in 1.12.0:** loyalty **redemption** (points → discount at settlement); two-way
**threaded message replies**; **broadcast announcements** (owner/manager → staff, live toasts).

**Delivered in 1.13.0:** configurable **permissions** (refund/void/discount × role); **manual
discounts/comps** and order **voids** (with inventory restock + audit); loyalty **tiers**
(Bronze/Silver/Gold) and **referrals**.

**Delivered in 1.14.0:** **split-the-bill** (partial payments); menu **photos, allergens &
dietary tags** with a public dietary filter + kitchen allergen flags; **post-visit guest
feedback** (ratings/comments) with an owner view.

**Delivered in 1.15.0:** **table transfer & merge**; **waste/spoilage logging**; **consolidated
approvals dashboard** (owner + manager).

**Delivered in 1.16.0:** **vendor master records**; **self-service My Pay & Tips** (all staff);
**course tagging** with kitchen grouping.

**Delivered in 1.17.0:** **order edit** (add/change-qty/remove items with inventory
re-depletion + audit, blocked once paid).

**Delivered in 1.18.0:** **cycle counts** (inventory reconciliation); **per-employee
performance** analytics; **certification tracking** with expiry highlighting.

**Tier 2–3 — Operational depth (remaining):** barcode receiving; expiry/lot (FIFO) tracking;
shift swapping; waitlist; regional-manager role & cross-location staff lending; central menu
with overrides; 2FA; inventory valuation & COGS. *(Through 1.18.0: messaging, discounts/comps/
voids, split-the-bill, transfer/merge, waste, approvals, vendors, self-service pay, courses,
order edit, cycle counts, staff performance, and certifications shipped.)*

**Tier 4 — High impact:** par levels + auto-reorder; executive multi-location dashboard &
benchmarking; demand-based scheduling; finance/accounting integration. *(Configurable
roles/permissions shipped in 1.13.0; QR ordering, accounts/loyalty incl. tiers/referrals, and
email marketing in 1.11.0–1.13.0.)*

**Tier 5 — Transformational:** *(All three shipped — inventory auto-depletion in 1.9.0;
real-time notifications and online ordering in 1.10.0.)* Remaining extensions: online
prepayment, SMS/push delivery, and a delivery-dispatch workflow.

**Scale-dependent (defer until past a single server):** PostgreSQL migration; Redis pub/sub for
multi-instance WebSocket fan-out; accessibility (WCAG); i18n / multi-currency; GDPR
data-deletion workflows.

## 16. Glossary

| Term | Meaning |
|---|---|
| **Location** | A single physical restaurant branch. |
| **Role** | One of: owner, manager, stockroom, chef, waiter, frontdesk, employee. |
| **Area** | A named zone within a location (Main Hall, Patio, Bar, Private Dining). |
| **Table status** | empty · occupied · waiting_order · ordered · waiting_food · need_help · waiting_payment · special_request · ready_clean · cleaning. |
| **Order lifecycle** | pending → preparing → ready → served. |
| **Payment status** | pending → paid (→ refunded), or failed. |
| **Reservation lifecycle** | pending → confirmed → seated → completed; terminal: no_show, cancelled. |
| **Supply order status** | pending → approved → shipped → received. |
| **Transfer status** | pending → approved → in_transit → received; terminal: cancelled. |
| **Time-off status** | pending → approved / denied; or cancelled by requester. |
| **Special request** | Free-text note attached to an order (allergies, preferences). |

## 17. Testing & Verification Strategy

- **Runtime verification** — features are validated by driving the running application end-to-end in a real browser (Microsoft Edge via Playwright), capturing screenshots and asserting on observed behavior, in addition to direct API smoke tests.
- **API checks** — endpoints are exercised with representative payloads (auth, role enforcement, success and error paths).
- **Real-time** — WebSocket broadcasts are verified with a second client observing events triggered by the first.

## 18. Backup & Recovery

- All persistent data lives in the single SQLite database file (`restaurant.db`).
- **Backup**: copy the database file while the server is stopped, or use SQLite's online backup/`.backup` command for a hot copy.
- **Restore**: replace the file and restart the server.
- **Reset to demo**: `npm run seed` rebuilds the schema and repopulates demo data (destructive).

## 19. Changelog

| Version | Highlights |
|---|---|
| 1.0.0 | Core platform: auth, staff, time clock, areas/tables, orders, inventory & supply chain, locations, timesheets/payroll. |
| 1.1.0 | Time-off requests, internal messaging + notification bell, mobile-responsive UI, light/dark theme. |
| 1.2.0 | Real-time WebSocket updates, reservations, menu management & order pricing, account settings (profile + password), audit log. |
| 1.3.0 | Universal clock-in for non-owner staff, employees act as waiters, order special requests, manager low-stock alerts. |
| 1.4.0 | Bill settlement & payments (Stripe, with simulated fallback) and tips into payroll; public customer menu and online reservation booking. |
| 1.5.0 | Sales & revenue analytics dashboard (owner + manager); Stripe test-key setup guide (`.env.example`, `PAYMENTS_SETUP.md`); configurable sales-tax rate. |
| 1.6.0 | Email layer (SMTP or simulated): reservation confirmations with codes + guest lookup/cancel, emailed digital receipts with public receipt page, and self-service forgot/reset password. ER-diagram overview added. |
| 1.7.0 | Session revocation: "log out everywhere" plus automatic token invalidation on password change, password reset, and account deactivation, via a per-user `token_version` checked on every request. |
| 1.8.0 | Enforced clock-in for non-owner floor actions; automatic task hand-off on clock-out (reassign open orders/areas to the least-loaded on-duty colleague, or alert the owner when nobody is available); paid orders disable charging and show a "Paid" state. |
| 1.9.0 | Inventory auto-depletion via recipes/BOM with auto-86; chef can "86" items; low-stock alerts for stockroom & chef; owner-configurable sales-tax & service-charge; payments & refunds UI; stronger password policy (min 8) and broader rate limiting. |
| 1.10.0 | Real-time operational notifications (order-ready, needs-help, low-stock, new online order) as role-targeted toasts + reservation reminders; customer online ordering (pickup/delivery, server-priced, pay-on-collection) with tracking codes, kitchen integration, and a manager fulfillment panel. |
| 1.11.0 | QR-code table ordering (dine-in straight to the kitchen, printable per-table codes); customer accounts with loyalty points (1/$1) + order history; owner email-marketing campaigns to opted-in customers with one-click unsubscribe. |
| 1.12.0 | Loyalty redemption (points → discount at settlement, 20 pts = $1); two-way threaded message replies (owner/manager ↔ staff); broadcast announcements (owner/manager → staff) delivered as live toasts. |
| 1.13.0 | Configurable staff permissions (refund/void/discount per role, owner-managed); manual discounts/comps at settlement; order voids with inventory restock + audit; loyalty tiers (Bronze/Silver/Gold) and referral bonuses. |
| 1.14.0 | Split-the-bill via partial payments (proportional tax/service, settle once fully covered); menu photos + allergens + dietary tags with a public dietary filter and kitchen allergen flags; post-visit guest feedback (ratings/comments) with an owner dashboard. |
| 1.15.0 | Table transfer (move an order) & merge (combine a table's open orders); waste/spoilage logging with reasons (deducts stock + audit); consolidated pending-approvals dashboard for owners & managers. |
| 1.16.0 | Vendor master records (linked to supply orders); self-service "My Pay & Tips" for all staff (hours/gross/net/tips, last 7 days); course tagging with kitchen-ticket grouping (Appetizers/Mains/Desserts/Drinks). |
| 1.17.0 | **Order edit: add items, change quantities, and remove items on an unpaid order — inventory re-depletes/restocks the delta (with auto-86) and every change is audited; blocked once a payment exists.** |

---

*End of document.*
