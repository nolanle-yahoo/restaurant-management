# Restaurant Management System — Functional & Technical Documentation

**Version:** 1.45.0
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
   ├─ 26 route modules under /api/*
   ├─ lib/ws.js     → real-time broadcast bus
   ├─ lib/audit.js  → audit logging helper
   └─ SPA fallback + global error handler
   │
   ▼
SQLite database (34 tables)
```

- The server boots by validating `JWT_SECRET`, creating the schema (idempotent), mounting all
  routes, attaching the WebSocket server to the same HTTP listener, and serving the static
  frontend.
- The frontend is a set of role-specific pages served statically; each authenticates with a
  JWT stored in the browser and calls the REST API. Pages that benefit from live data open a
  WebSocket connection scoped to their location.

---

## 4. User Roles & Access Model

Ten roles are enforced both in the UI (page routing) and on the server (`requireRole`).

| Role | Scope | Primary responsibilities |
|---|---|---|
| **Owner** | All locations | Full oversight: staff, payroll, inventory, menu, reservations, audit log, cross-location reporting, regions & staff lending. |
| **Regional** | Own region | Oversee a region's locations (KPI overview) and lend staff between them. Scoped to the assigned region. |
| **Driver** | Own location | Delivery driver: see assigned deliveries, advance their status (picked up / delivered / failed), and share live location for customer tracking. |
| **Manager** | Own location | Run a single location: staff, schedule, timesheets, inventory, supply, transfers, floor plan, reservations, menu, approvals. |
| **Stockroom** | Own location | Inventory and supply-chain operations (uses the manager dashboard). |
| **Chef** | Own location | Kitchen order queue, inventory quick view. |
| **Waiter** | Own location | Assigned area, full floor, take/serve orders. |
| **Bartender** | Own location | Run **bar tabs** (open → add rounds → settle), 86 bar items, view bar stock. |
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
- **FR-4.5** **Table-level assignment** — managers/owners assign (or clear) an individual
  table's staff member directly from the floor plan, independent of area assignments. A waiter
  (or employee/front-desk) can **claim** any table that nobody has been assigned to yet from the
  Full Floor, and **release** a table assigned to them. Claiming is a floor operation (the staff
  member must be clocked in) and is location-scoped; assignment changes broadcast in real time.
- **FR-4.6** Table status changes broadcast in real time to all connected clients at that
  location.
- **FR-4.7** **Transfer & merge** — an open order can be moved to another table (transfer), and
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
- **FR-5.7** **Courses & course-firing** — each order item is tagged with a course (derived
  from its menu category: Appetizers/Mains/Desserts/Drinks). The kitchen queue groups a ticket's
  items by course and controls **when each course starts cooking**: a dine-in order auto-fires
  its first course and **holds** the rest, while to-go (online/pickup/delivery) orders fire
  everything at once. Held courses appear dimmed with a **🔥 Fire** button; the chef (or any
  front-of-house role) fires the next course when the table is ready, and a "Fire all remaining"
  shortcut fires everything. Firing a course starts its prep timer and is audited (`course_fire`).
  Items added to an in-progress order fire immediately.
- **FR-5.7a** **Prep timers** — once a course is fired, the KDS shows a live count-up timer
  (m:ss) against a per-item cook-time target (`prep_minutes`, set per menu item; a sensible
  per-course default is used when none is configured). The timer chip turns amber as it nears
  the target and red ("LATE") once it's exceeded, so cooks and managers can pace service.
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
- **FR-6.7** **Central menu with per-location overrides** — owners maintain a single **central
  template** (categories + items). "Apply to locations" pushes it to every active location,
  upserting each location's menu (matched by a `central_id` link). Names, descriptions,
  allergens, dietary tags, sort order, and category are always synced; **price** is synced only
  where a location hasn't overridden it, and **availability** is always left to the location.
  Editing a central-linked item's price marks it as a **local override** (protected from future
  syncs); a **"reset to central"** action clears the override and restores the template price.
  Locations may still have purely local items. Only owners manage the central template; managers
  manage their own location's menu and overrides.

- **FR-6.8** **Menu modifiers & combos** — owners/managers attach **option groups** to a menu
  item (e.g., Size, Add-ons, Choose a side), each with options carrying a **price delta** and
  per-group **min/max** selection rules. A group with `min_select ≥ 1` is a **required choice** —
  the pattern for building a **combo/meal**. Guests pick options when ordering (radio for
  single-select, checkboxes for multi); the server **validates** min/max + option validity and
  **prices** the line (base + deltas, never trusting the client). The chosen options are stored
  per order line and shown on the **kitchen ticket**, **tracking page**, and **receipt**.

### 5.7 Reservations
- **FR-7.1** Owners, managers, and front desk create and manage reservations (guest name,
  contact, party size, date, time, optional table and notes).
- **FR-7.2** Reservations follow a lifecycle: pending → confirmed → seated → completed, with
  no-show and cancelled terminal states.
- **FR-7.3** Reservations are filterable by location (owner), date, and status; changes
  broadcast in real time.
- **FR-7.4** **Walk-in waitlist** — front desk/managers add walk-in parties (name, size, quoted
  wait) to a live queue and seat or remove them; updates broadcast in real time.

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
- **FR-8.10** **SKU / scan-to-receive** — inventory items carry a SKU; stock can be received by
  scanning/typing the SKU + quantity (adds stock + logs a transaction).
- **FR-8.11** **Valuation & COGS** — items carry a unit cost; owners/managers see current stock
  value (by category) and the cost of stock consumed over a date range.
- **FR-8.12** **Expiry / lot (FIFO) tracking** — received stock can be recorded as a dated *lot*
  (expiry date + optional lot #). Consumption (sales depletion, waste, transfers, negative cycle-
  count variance) draws down lots in **FIFO order** (earliest expiry first). An "Expiring Soon"
  panel lists lots expiring within a window (7/14/30 days, including already-expired), and a lot
  can be **discarded** — writing it off as waste and reducing stock. `inventory.quantity` remains
  the authoritative total; lots are a parallel ledger for expiry and traceability.

### 5.9 Scheduling
- **FR-9.1** Owners and managers build weekly staff schedules — a grid of **every role's** staff
  (chef, waiter, front desk, employee, stockroom, manager, …) × days, with add/edit/delete of
  shifts (work date, start/end) and week navigation. Managers manage their own location;
  **owners review and assign/adjust any location** via a location picker on the Schedule screen.
- **FR-9.2** Every staff member sees their own upcoming shifts under Account Settings → My
  Schedule (available on all role dashboards).
- **FR-9.3** **Shift swapping** — staff offer an upcoming shift to colleagues at their location
  (open to anyone, or directed to a named colleague). A colleague claims it, and an owner or
  manager approves the hand-over, which reassigns the shift. Requesters can cancel a pending
  offer; owners/managers can reject. Managers review pending swaps from the Schedule tab.

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
  date range and reason — available to **every role** from Account Settings → Time Off (and on
  the role dashboards that surface it), so staff can request and track requests from any page.
- **FR-11.2** Managers approve/deny requests for their location; owners across all locations;
  reviewers may attach a note.
- **FR-11.3** Employees can cancel their own pending requests and track status.
- **FR-11.4** **Consolidated approvals** — owners and managers see a dashboard card summarizing
  everything awaiting action (pending time-off, transfer requests, and supply orders) with
  one-click links to the relevant review screens.

### 5.12 Internal Messaging & Feedback
- **FR-12.1** Employees send messages/feedback addressed to their manager, the owner, or both —
  available to **every role** from Account Settings → Message (with a thread of their sent
  messages and any replies), so all staff can reach leadership from any page.
- **FR-12.2** Managers see messages for their location; owners see all messages across
  locations; messages can be marked read.
- **FR-12.3** A topbar notification bell shows the unread message count and links to the inbox.
- **FR-12.4** **Threaded replies** — owners/managers can reply to an employee's message; the
  sender sees the reply thread on their own messages view (two-way conversation).
- **FR-12.5** **Broadcast announcements** — owners/managers post announcements to staff (own
  location, or all locations for owners). They appear in staff message views and are pushed
  live as real-time toasts (FR-14.2).

- **FR-12.4** **Notifications bell reaches every staff member** — a 🔔 bell in the topbar on
  **every staff page** (all roles) aggregates what leadership sent the viewer: owner **global**
  announcements + their **own-location manager** announcements, **and** owner/manager **replies**
  to the staff member's own messages. Each item is labeled by author role (**Owner**/**Manager**)
  and shows an **unread count**. **Clicking an item opens a popup** with the full message and
  **clears it from the unread count**; "Mark all read" clears everything. Read state is remembered
  per user (persists across reloads). New announcements also push a live toast.

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

### 5.15a Bar Tabs (Bartender)
- **FR-15a.1** A **bartender** runs **bar tabs** from a dedicated Bar Station. A tab is an open
  running check at the bar — stored as an order with `order_type='bar'` and no table — that the
  bartender opens by guest/tab name, optionally flagging **🪪 ID checked** (age verification).
- **FR-15a.2** Drinks are added to the selected tab from the **Bar Menu** (beverage items); each
  add re-uses the shared order-item flow, so it audits and **depletes liquor inventory** via the
  normal recipe/BOM path. Items on a bar tab are fired immediately (made at the bar, not the kitchen).
- **FR-15a.3** A tab stays **open** until settled; **Close & Settle** uses the shared payment flow
  (cash/card/mobile + tip, split-aware). Once a payment covers the tab it drops off the open list.
  Bartenders may toggle ID-checked and remove lines while a tab is open.
- **FR-15a.4** Bar revenue flows into the standard payments/analytics (owners & managers see it).
  The Bar Station also shows a **Bar Stock** quick view (beverage inventory with low-stock flags)
  and lets the bartender **86** a drink (toggle availability).
- **FR-15a.5** Bar-tab actions are location-scoped and role-gated: only bartenders (own location),
  managers, and owners can open/modify tabs; the bartender must be clocked in.

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
- **FR-17.10** **Self-service waitlist (virtual queue)** — guests can **join the waitlist online**
  (location, name, party size, phone) without staff entry. They get a code and a live status
  page showing their **position in line** and an **estimated wait** (auto-refreshing), and can
  **leave the queue** anytime. Staff see online joins flagged in the host queue and can **page**
  a party when their table is ready — which **texts the guest** (SMS) and marks them notified;
  the guest's page then shows "your table is ready." Seating/removing closes their status.

- **FR-17.3** **Path split** — the guest site is the front door at `/` (a landing page with
  Order / Reserve / Menu calls-to-action, account/loyalty + reservation-lookup links, and a live
  list of locations from the public API). The **staff app** lives at `/staff` (login → role
  dashboards). Both run on the **same back-end and API**; only the entry point differs. Staff
  auth redirects (sign-out, expired session, unauthorized page) return to `/staff`, and a
  "Staff Login" link sits discreetly on the home page. *(Subdomains — `www.` vs `app.` — are a
  drop-in upgrade once a custom domain is attached; no back-end change required.)*
- **FR-17.4** **Online ordering with prepayment + tipping** — anyone can place a **pickup or
  delivery** order from a location's menu without logging in. Prices are server-authoritative.
  Checkout adds a **tip** (None / 15% / 18% / 20% / custom) and shows a full breakdown
  (subtotal · service · tax · tip · total), then the guest **prepays by card**. The flow is a
  standard two-step Stripe sequence: `POST /order/intent` creates a PaymentIntent for the priced
  cart (no order yet); the card is confirmed client-side (Stripe.js Elements); then
  `POST /order/confirm` verifies the intent **succeeded** (and, with real Stripe, that the
  captured amount matches) before creating the now-**paid** order, firing it to the kitchen,
  depleting inventory, awarding loyalty, and emailing a receipt. The customer gets a **tracking
  code** and a **receipt code**. Confirmation is idempotent (a given intent fulfils one order).
- **FR-17.4a** **Stripe configuration** — set `STRIPE_SECRET_KEY` (and `STRIPE_PUBLISHABLE_KEY`)
  to take real card payments; without them the system runs in **simulated mode** (no external
  call, intents auto-"succeed") so the full flow works for demos. This mirrors the email layer's
  real-or-simulated behavior and applies to staff card payments too.
- **FR-17.4d** **Scheduled order-ahead + curbside** — at checkout a pickup/delivery guest can
  choose **ASAP** or **schedule** a future time (validated server-side: future, within 7 days),
  shown to the kitchen as "⏰ Scheduled HH:MM". Pickup orders can opt into **curbside** with a
  vehicle description; on the tracking page the guest taps **"I'm here"**, which records arrival
  and alerts staff (toast + Telegram) and flags the kitchen ticket **ARRIVED**.
- **FR-17.4b** **Apple Pay / Google Pay** — the checkout uses the Stripe **Payment Element**,
  which automatically offers Apple Pay and Google Pay (alongside card entry) on supported
  devices/browsers when real keys are configured. No separate buttons to maintain; wallets ride
  the same PaymentIntent (`automatic_payment_methods`). *(Apple Pay also requires Stripe domain
  verification + HTTPS in production.)*
- **FR-17.4c** **Saved cards (signed-in customers)** — a signed-in customer can tick "save this
  card" at checkout; the card is stored on a Stripe **Customer** (only brand/last4/expiry are
  kept locally in `customer_cards`, never the PAN). On a later order they pick a saved card and
  it's charged off-session — no re-entry. Saved cards are listed and removable under **My Account
  → Payment Methods**. In simulated mode a representative card is recorded so the flow is
  demonstrable end-to-end.
- **FR-17.5** **QR-code table ordering** — each table has a QR code (printable from the manager
  Floor Plan) that opens the menu in "table mode"; guests order **dine-in** straight to the
  kitchen, the table flips to *ordered*, and a server settles the bill at the table (tip handled
  at settlement). *(Prepayment applies to pickup/delivery; dine-in QR pays at the table.)*
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

### 5.19 Notifications & Self-Service (Email & SMS)
- **FR-19.1** A shared email layer sends transactional messages via SMTP when configured, or
  records them to an email log in simulated mode otherwise — so all flows work without setup.
- **FR-19.2** Guests who provide an email receive a **reservation confirmation** with a code,
  and can **look up or cancel** their reservation using that code plus their email/phone.
- **FR-19.3** A **digital receipt** is generated for every settled bill, emailable to the guest
  and viewable/printable at a public receipt page via its receipt code.
- **FR-19.4** Users can request a **password reset**; a one-time, expiring link is emailed and
  consumed on the reset page. Requests never reveal whether an email is registered.
- **FR-19.5** **SMS notifications** — time-sensitive guest updates are also texted (when a phone
  is on file): online **order received**, **payment received** (prepaid), **ready for pickup**,
  delivery **on the way** / **delivered**, and **reservation request** confirmation. Numbers are
  normalized to E.164; every message is recorded in `sms_log`.
- **FR-19.6** **Pluggable SMS provider** — `SMS_PROVIDER` selects the channel: `simulated`
  (default; logged only), `twilio` (paid), `textbelt` (free 1/day on the default key, or free
  unlimited self-hosted via `TEXTBELT_URL`), or `email_gateway` (free carrier email-to-SMS, e.g.
  `vtext.com` / `txt.att.net` / `tmomail.net` — reuses the SMTP email layer). Unset/`auto` uses
  Twilio when configured, else simulated. `GET /api/public/sms-config` reports the active
  provider and whether it's live. The email-gateway path honestly records `simulated` when SMTP
  isn't configured (so nothing silently "succeeds").
- **FR-19.7** **Telegram ops notifier (optional)** — a free, reliable business push channel: a
  Telegram bot posts **new order** (incl. paid) and **reservation request** alerts to one chat
  your staff are in (set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`). It's keyed by chat id, not a
  phone number, so it complements (doesn't replace) guest SMS. Simulated (logged to
  `telegram_log`) when unconfigured; `GET /api/public/sms-config` reports `telegram_live`.

### 5.16a Promo Codes & Gift Cards
- **FR-16.10** **Promo codes** — owners/managers create discount codes (% or $ off), with an
  optional minimum subtotal, usage limit, validity window, and location scope. Online guests
  enter a code at checkout; the server validates it (active, in-window, under limit, meets
  minimum) and applies the discount to the subtotal before tax/service. `used_count` increments
  on a completed order; codes can be toggled active/inactive.
- **FR-16.11** **Gift cards** — anyone can buy a stored-value gift card (Stripe; simulated
  without keys); a code is issued and emailed to the recipient. At online checkout a guest
  applies a gift card, which draws down its balance toward the total — if it covers the order
  fully, no card is charged. Balances + a redemption ledger are tracked; owners see issued cards.

### 5.7a Reservation Deposits & Guest CRM
- **FR-7.5** **Reservation deposits** — owners set a flat **deposit** and a **minimum party size**
  (Settings). Public bookings that meet the threshold must pay the deposit (Stripe; simulated
  without keys) to hold the table; the reservation tracks `deposit_status` (none/paid/refunded).
  Owners/managers can **refund** a paid deposit (e.g., an honored cancellation).
- **FR-7.6** **Guest CRM** — owners/managers/front-desk get a searchable **Guests** view over
  registered customers showing tier, points, order count, and lifetime spend. Each guest has a
  profile with order + reservation history and editable **VIP flag, tags** (e.g., "allergy:
  nuts", "regular"), and **private notes**. VIPs sort to the top.

### 5.20a Delivery Dispatch & Driver Tracking
- **FR-21.1** Every **delivery** order gets a delivery record with its own lifecycle —
  `pending → assigned → picked_up → delivered` (or `failed`) — separate from the kitchen order
  status.
- **FR-21.2** **Dispatch** — owners/managers see a delivery board (customer, address, order
  total, status) and assign a delivery to an active **driver** with an optional ETA; reassignment
  is allowed until it's delivered.
- **FR-21.3** **Driver app** — a driver (role `driver`) signs in to a dedicated page listing
  their assigned deliveries with the address (map link), customer phone (tap-to-call), and order
  total; they advance status (**Picked up → Delivered**, or mark **failed**). Delivering also
  closes the kitchen order (served). Drivers must clock in like other staff.
- **FR-21.4** **Live tracking** — the driver can opt to share GPS location (periodic pings); the
  customer's order-tracking page shows the delivery timeline, assigned driver's first name, ETA,
  and a **live map** of the driver's position (OpenStreetMap/Leaflet), auto-refreshing while the
  delivery is in motion. The map is best-effort; the status timeline always works.

### 5.20 Multi-Location: Regions & Staff Lending
- **FR-20.1** Owners group locations into **regions** (create / rename / delete; assign each
  location to a region). Deleting a region unassigns its locations and reverts its regional
  managers to plain managers.
- **FR-20.2** Owners promote a manager to a **regional manager** (role `regional`) over one
  region. The change bumps the user's token version so it takes effect on next sign-in. A
  regional manager lands on a dedicated dashboard scoped to their region.
- **FR-20.3** The **regional overview** shows each region location with live KPIs (on-duty staff,
  open orders, occupancy, low-stock count) plus the staff working across the region.
- **FR-20.4** **Cross-location staff lending** — owners (anywhere) and regional managers (within
  their region) temporarily lend a staff member to another location. While on loan the user's
  working location is the borrowing location; **returning** restores their home location. A staff
  member can be on only one active loan at a time; managers cannot lend.

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

SQLite database with 34 tables. Core entities and relationships:

> **Entity-relationship overview.** `locations` is the hub: `users`, `areas`, `tables`,
> `orders`, `inventory`, `reservations`, `menu_categories/items`, and `payments` all carry a
> `location_id`. `orders` → `order_items` (1-to-many) and `orders` → `payments` (1-to-1 when
> settled). `users` are referenced by `clock_records`, `orders.waiter_id`,
> `time_off_requests`, `employee_messages`, `audit_log`, and `password_reset_tokens`.
> `menu_categories` → `menu_items` (1-to-many). All child rows reference parents by foreign key.

- **locations** — restaurant branches.
- **users** — staff accounts (role enum incl. `bartender`, location FK, hourly rate, active flag).
- **orders** — also carry `order_type` (`dine_in`/`pickup`/`delivery`/**`bar`**) and `id_checked` (age verification flag on bar tabs).
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
- **waitlist** — walk-in host queue (party, size, quote, status).
- **inventory** also carries `sku` and `unit_cost` (for scan-receiving and valuation).
- **order_items** also carry a `course` (Appetizers/Mains/Desserts/Drinks) for kitchen grouping,
  `fired_at` (when the course was sent to the line; null = held), and a `prep_minutes` cook-time
  snapshot for the KDS prep timer.
- **menu_items** also carry `image_url`, `allergens`, `dietary` tags, and `prep_minutes` (the
  kitchen cook-time target used to drive KDS prep timers).
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
| PUT | `/:id/assign` | Owner, Manager | Assign (or clear) the table's staff member. |
| POST | `/:id/claim` | Waiter, Employee, Front Desk, Manager, Owner | Claim a table that has no assignee (must be clocked in). |
| POST | `/:id/release` | Assignee, Manager, Owner | Free a table's assignment. |
| DELETE | `/:id` | Owner, Manager | Delete table. |

### Bar Tabs — `/api/bar`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/tabs` | Bartender, Manager, Owner | Open bar tabs at the location (running totals + items); `?include_closed=1` to include settled. |
| POST | `/tabs` | Bartender (on duty), Manager, Owner | Open a tab (`name`, optional `id_checked`). Creates an `order_type='bar'` order. |
| PUT | `/tabs/:id` | Bartender (on duty), Manager, Owner | Update a tab's `name` / `id_checked`. |

*(Adding drinks to a tab and settling it reuse `POST /api/orders/:id/items` and the `/api/payments` flow.)*

### Orders — `/api/orders`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | All non-owner staff + Owner | Orders for location (optional status filter). |
| POST | `/` | Waiter, Manager, Employee, Chef, Front Desk, Stockroom | Create order with items + special request; broadcasts; audited. |
| PUT | `/:id` | Same as POST + Owner | Advance status; broadcasts; audited. |
| PUT | `/:id/fire` | On-duty Owner/Manager/Waiter/Chef/Employee/Front Desk | Fire a held course (body `{ course }`) or all held courses (`{ course: 'all' }` / omitted) — starts its prep timer; moves a pending order to preparing; audited (`course_fire`). |
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
| PUT | `/:id` | Owner, Manager, Stockroom | Update an item's SKU / min level / unit cost. |
| POST | `/receive` | Owner, Manager, Stockroom | Receive stock by SKU (or item_id) + quantity; optional `expiry_date` + `lot_code` create a lot. |
| GET | `/valuation` | Owner, Manager | Stock value (by category) + consumed cost over a range. |
| GET | `/lots` | Owner, Manager, Stockroom, Chef | Active lots (remaining > 0), earliest expiry first; optional `item_id`. |
| GET | `/expiring` | Owner, Manager, Stockroom, Chef | Lots expiring within `days` (default 7), incl. already-expired; counts. |
| POST | `/lots/:id/discard` | Owner, Manager, Stockroom, Chef | Write a lot off as waste and reduce stock by its remaining qty. |

### Locations — `/api/locations`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Any | List locations. |
| GET | `/summary` | Any | Per-location KPIs + global totals. |

### Deliveries — `/api/deliveries`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager | Dispatch board: delivery orders + status/driver (location-scoped). |
| GET | `/drivers` | Owner, Manager | Active drivers (on-duty first) to assign. |
| POST | `/:id/assign` | Owner, Manager | Assign/reassign a driver (+ optional `eta_minutes`). |
| GET | `/mine` | Driver, Owner, Manager | The driver's active (assigned/en-route) deliveries. |
| POST | `/:id/status` | Driver (own), Owner, Manager | Advance status: `picked_up` / `delivered` / `failed`. |
| POST | `/:id/location` | Driver (own) | Push the driver's GPS `lat`/`lng` for live tracking. |

### Promotions & Gift Cards — `/api/promos`
| Method | Path | Access | Description |
|---|---|---|---|
| GET · POST · PUT · DELETE | `/[:id]` | Owner, Manager | Manage promo codes (managers scoped to their location). |
| GET | `/giftcards` | Owner, Manager | Issued gift cards (code, balance, status). |

*(Public: `POST /api/public/promo/check`, `GET /api/public/giftcards/:code`, `POST /api/public/giftcards/intent` + `/confirm`; gift card + promo apply within `/api/public/order/intent` + `/confirm`.)*

### Guests (CRM) — `/api/customers`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager, Front Desk | Search guests with spend/visit aggregates + tier. |
| GET | `/:id` | Owner, Manager, Front Desk | Guest profile + order/reservation history. |
| PUT | `/:id` | Owner, Manager, Front Desk | Update VIP flag, tags, notes. |

### Regions & Staff Lending — `/api/regions`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner | Regions with their locations + regional managers. |
| POST · PUT · DELETE | `/[:id]` | Owner | Create / rename / delete a region. |
| PUT | `/assign-location` | Owner | Set (or clear) a location's region. |
| POST | `/assign-manager` | Owner | Promote a manager to `regional` for a region (or demote with `region_id: null`). |
| GET | `/mine` | Regional, Owner | Region overview: locations + KPIs + staff (owner passes `?region_id`). |
| GET | `/loans` | Owner, Regional | Active + recent staff loans (region-scoped for regional). |
| POST | `/lend` | Owner, Regional | Lend a staff member to another location. |
| POST | `/loans/:id/return` | Owner, Regional | Return a lent staff member to their home location. |

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
| POST | `/items/:id/reset-central` | Owner, Manager | Clear a price override and restore the central template price. |
| GET | `/items/:id/modifiers` | Owner, Manager, Chef | An item's modifier groups + options. |
| POST · PUT · DELETE | `/items/:id/modifier-groups`, `/modifier-groups/:id` | Owner, Manager | Manage option groups (name, min/max). |
| POST · PUT · DELETE | `/modifier-groups/:id/options`, `/modifier-options/:id` | Owner, Manager | Manage options (name, price delta, availability). |
| GET · POST · PUT · DELETE | `/central/categories[/:id]` | Owner | Manage the central menu's categories. |
| GET · POST · PUT · DELETE | `/central/items[/:id]` | Owner | Manage the central menu's items (with linked-location counts). |
| POST | `/central/apply` | Owner | Push the central template to locations (`location_ids: 'all'` or `[ids]`); returns created/updated counts. |

### Audit — `/api/audit`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager | Audit entries (scoped by role). Filters: `action`, `location_id` (owner only), `start`/`end` (date range — `YYYY-MM-DD`, inclusive), `limit`. |

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

### Schedules — `/api/schedules`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager | Shifts for a location over a date range. |
| GET | `/mine` | Any staff | The caller's own upcoming shifts. |
| POST | `/` | Owner, Manager | Create a shift (user, date, start, end). |
| PUT | `/:id` | Owner, Manager | Update a shift. |
| DELETE | `/:id` | Owner, Manager | Remove a shift. |

### Shift swaps — `/api/shift-swaps`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Any staff | Swaps relevant to the caller (own/targeted/claimable; owner & manager see their scope). |
| POST | `/` | Any staff | Offer one of your own upcoming shifts (optional `target_user_id`, `note`). |
| POST | `/:id/accept` | Any staff | Claim an open offer (or accept one directed to you). |
| POST | `/:id/approve` | Owner, Manager | Approve an accepted swap — reassigns the shift. |
| POST | `/:id/reject` | Owner, Manager | Reject an open or accepted swap. |
| DELETE | `/:id` | Requester / Owner / Manager | Cancel a pending swap. |

### Waitlist — `/api/waitlist`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Owner, Manager, Front Desk | Current waiting parties (location-scoped). |
| POST | `/` | Owner, Manager, Front Desk | Add a walk-in party. |
| PUT | `/:id` | Owner, Manager, Front Desk | Seat or remove a party (status). |
| POST | `/:id/notify` | Owner, Manager, Front Desk | Page a waiting party (texts them; marks notified). |

### Public (customer-facing, no authentication) — `/api/public`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/locations` | Public | Active locations (name, address, phone). |
| GET | `/menu` | Public | Available menu (categories + items with prices) for a location. |
| POST | `/reservations` | Public (rate-limited) | Submit an online reservation request; created as **pending**, returns a confirmation code, emails the guest. |
| GET | `/reservations/lookup` | Public | Look up a reservation by confirmation code + matching email/phone. |
| POST | `/reservations/cancel` | Public | Cancel a reservation by confirmation code + matching email/phone. |
| POST | `/reservations/deposit/intent` · `/reservations/deposit/confirm` | Public | Pay a required reservation deposit (Stripe two-step; simulated without keys). |
| POST | `/order` | Public (rate-limited) | Place a dine-in (QR) order, or a pickup/delivery order to pay on collection (server-priced); links the customer if signed in; returns a tracking code. |
| GET | `/pay-config` | Public | Whether card prepayment is enabled + the Stripe publishable key. |
| POST | `/order/intent` | Public (rate-limited) | Prepay step 1: price the cart (incl. tip) and create a Stripe PaymentIntent; returns client secret/simulated flag + breakdown. No order created yet. |
| POST | `/order/confirm` | Public (rate-limited) | Prepay step 2: verify the intent succeeded (and amount matches, real mode), then create the **paid** order, fire it to the kitchen, and email a receipt. Idempotent per intent. |
| GET | `/order` | Public | Track an online order by tracking code (status + items; for delivery: driver first name, status, ETA + live coords). |
| POST | `/waitlist` | Public (rate-limited) | Join the virtual queue; returns a code, position, and ETA. |
| GET | `/waitlist` | Public | Live status by code (position, ETA, ready flag, status). |
| POST | `/waitlist/cancel` | Public | Leave the queue by code. |
| POST | `/order/arrived` | Public | Curbside "I'm here" by tracking code — records arrival + alerts staff. |
| POST | `/account/register` · `/account/login` | Public (rate-limited) | Customer sign-up / sign-in; returns a customer JWT. |
| GET | `/account/me` · `/account/orders` · `/account/loyalty` | Customer | Profile, order history, and points + ledger. |
| GET · DELETE | `/account/cards[/:id]` | Customer | List or remove saved payment cards (brand/last4/expiry only). |
| PUT | `/account/preferences` | Customer | Toggle marketing opt-in. |
| POST | `/unsubscribe` | Public | One-click unsubscribe via emailed token. |
| POST | `/feedback` | Public (rate-limited) | Submit a 1–5 rating + optional comment after any service. Accepts one of `receipt_code` (dine-in), `tracking_code` (online order), `reservation_code` (reservation), or `location_id` (general). The server derives the location + source; one review per order/reservation/receipt (duplicate → 409). |
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
| GET | `/` | Owner, Manager | Guest feedback/reviews (count + average + items), location-scoped for managers. Filters: `location_id` (owner only), `start`/`end` (date range — `YYYY-MM-DD`, inclusive). |

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
| `waitlist_update` | A walk-in waitlist entry was added or updated. |
| `table_update` | Table status changed. |
| `reservation_update` | Reservation created or updated. |

---

## 9. Frontend Application Map

| Page | Audience | Key areas |
|---|---|---|
| `home.html` | Public (customers) | **Served at `/`** — landing page: Order / Reserve / Menu CTAs, account & reservation-lookup links, live list of locations, discreet Staff Login link. |
| `index.html` | Staff | **Served at `/staff`** — staff login, theme toggle, mobile entry, "back to main site" link. |
| `menu.html` | Public (customers) | Browse any location's priced menu; no login. |
| `reserve.html` | Public (customers) | Submit an online reservation request (returns a confirmation code); no login. |
| `reserve-lookup.html` | Public (customers) | Look up or cancel a reservation by code + contact; no login. |
| `waitlist.html` | Public (customers) | Join the virtual queue; live position/ETA, "table ready" alert, leave-queue; no login. |
| `order.html` | Public (customers) | Order online: browse, cart, submit, track by code. Pickup/delivery, or "table mode" (`?table=`) for QR dine-in ordering. Links a signed-in customer for loyalty. |
| `account.html` | Public (customers) | Customer sign-up/sign-in, loyalty points, order history, marketing preference. |
| `unsubscribe.html` | Public (customers) | One-click marketing unsubscribe via emailed token. |
| `receipt.html` | Public (customers) | View/print an itemized receipt by receipt code; no login. |
| `reset.html` | Public | Set a new password from an emailed reset link. |
| `owner.html` | Owner | Overview, Staff & Locations, Timesheets, Warehouse, Supply, Transfers, Floor Plan, Admin Panel, Reservations, Menu (recipe editor + **Central Template** with apply-to-locations), Sales Analytics (incl. Tax & Service Charge settings and Payments & Refunds), Audit Log, Time Off, Messages, Marketing, **Regions & Lending**, **Schedule** (per-location assign/adjust). |
| `manager.html` | Manager / Stockroom | Staff, Schedule, Timesheets, Inventory, Warehouse, Supply, Transfers, Floor Plan (incl. printable table QR codes), Reservations, Menu, Sales Analytics (incl. Payments & Refunds), Time Off, Messages, **Delivery Dispatch**, **Promotions** (own-location promo codes + gift-card list); low-stock banner; Online Orders panel; live toasts. *(Stockroom sees a focused subset: Inventory/Warehouse/Supply/Transfers.)* |
| `regional.html` | Regional | Region overview (per-location KPIs) and staff lending within the region. |
| `driver.html` | Driver | Assigned deliveries with map link + tap-to-call, status actions (picked up / delivered / failed), and opt-in live location sharing. |
| `waiter.html` | Waiter | **My Area/Tables** (top: assigned area; bottom: tables assigned to or claimed by the waiter, each releasable), Full Floor, My Orders; take/serve with menu picker + special request; Settle Bill. |
| `chef.html` | Chef | Kitchen queue (dine-in + online pickup/delivery), inventory quick view, low-stock alert, Menu Availability (86/un-86), and live toasts. |
| `frontdesk.html` | Front Desk | Floor Map, Areas & Staff, Reservations, Waitlist. |
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

After seeding, the following representative accounts are available (29 users total across 5
locations, 2 regions, and all roles):

| Role | Email | Password | Location |
|---|---|---|---|
| Owner | `owner@restaurant.com` | `owner123` | All locations |
| Regional | `regional@east.com` | `region123` | East Region (Downtown/Uptown/Harbor) |
| Driver | `driver@downtown.com` | `driver123` | Downtown Bistro |
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

**Delivered in 1.19.0:** **walk-in waitlist**; **SKU / scan-to-receive**; **inventory valuation
& COGS**.

**Delivered in 1.20.0:** **staff scheduling** — weekly shift editor (owner/manager) + per-staff
"My Schedule"; the foundation that unblocks shift swapping.

**Delivered in 1.21.0:** **shift swapping** — staff offer a shift (open or to a named
colleague), a colleague claims it, and an owner/manager approves the reassignment.

**Delivered in 1.22.0:** **expiry / lot (FIFO) tracking** — dated receiving lots, FIFO
consumption, an "Expiring Soon" panel, and lot discard-to-waste.

**Delivered in 1.23.0:** **regions, a regional-manager role, and cross-location staff lending**
— group locations into regions, a region-scoped overview dashboard, and lend/return staff
between locations.

**Delivered in 1.24.0:** **central menu with per-location overrides** — a single owner-managed
template, one-click "apply to locations", protected price overrides, and reset-to-central.

**Remaining:** **2FA for owner/manager** — the last larger item.

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
| **Role** | One of: owner, regional, manager, stockroom, chef, waiter, frontdesk, employee, driver. |
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
| 1.17.0 | Order edit: add items, change quantities, and remove items on an unpaid order — inventory re-depletes/restocks the delta (with auto-86) and every change is audited; blocked once a payment exists. |
| 1.18.0 | Cycle counts (reconcile to a physical count with variance + adjustment); per-employee performance analytics (orders/sales/avg-ticket/tips); staff certification tracking with expiry highlighting. |
| 1.19.0 | Walk-in waitlist (host queue with live updates); SKU / scan-to-receive stock entry; inventory valuation & COGS (stock value by category + consumed cost over a range). |
| 1.20.0 | Staff scheduling: a weekly shift editor for owners/managers (employees × days grid, add/edit/delete, week navigation) and a per-staff "My Schedule" view — the foundation for shift swapping. |
| 1.21.0 | Shift swapping: staff offer an upcoming shift (open or to a named colleague), a colleague claims it, and an owner/manager approves the hand-over (which reassigns the shift). Requester-cancel and manager-reject supported; managers review pending swaps from the Schedule tab. |
| 1.22.0 | Expiry / lot (FIFO) tracking: received stock can carry an expiry date + lot #; consumption (sales, waste, transfers, negative counts) draws down lots earliest-expiry-first; an "Expiring Soon" panel (7/14/30-day windows) lists expiring/expired lots, each discardable to waste. |
| 1.23.0 | Regions & regional managers: owners group locations into regions and promote a manager to a region-scoped `regional` role with a KPI overview dashboard. Cross-location staff lending: owners (anywhere) and regional managers (within their region) temporarily lend staff to another location and return them to their home location. |
| 1.24.0 | Central menu with per-location overrides: owners maintain one central template and push it to all locations (upsert by `central_id`). Names/descriptions/allergens/dietary/sort/category always sync; price syncs only where a location hasn't overridden it; availability stays local. Editing a linked price marks an override (protected from sync); reset-to-central restores the template price. |
| 1.25.0 | **Table-level staff assignment: managers/owners assign or clear an individual table's staff member from the floor plan; waiters/employees/front-desk can claim any unassigned table from the Full Floor (clocked-in, location-scoped) and release their own. Universal self-service: Message and Time Off tabs added to Account Settings so every role can message leadership and request/track/cancel time off from any page.** |
| 1.26.0 | Owner schedule console: a per-location weekly schedule grid on the owner dashboard to review and assign/adjust shifts for every role (mirrors the manager's tool with a location picker). Confirmed universal Account Settings access — chef, employee, waiter, front desk, stockroom, regional, and manager all reach Message, Time Off, and My Schedule from any page. |
| 1.27.0 | UX & fixes: Account Settings modal is now resizable (drag) with an expand/shrink toggle and wrapping tabs; switching tabs shows only the selected pane (fixed a bug where panes stacked) and reopening returns to Profile. Stockroom now gets a focused manager dashboard (Inventory/Warehouse/Supply/Transfers only) with no manager-only requests — eliminating the prior 403 console noise; `switchTab` hardened against a not-yet-injected tab. |
| 1.28.0 | Guest/staff path split: the customer site is now the front door at `/` (new landing page with Order/Reserve/Menu CTAs + live locations), and the staff app moved to `/staff`. Same back-end and API for both; staff auth redirects now target `/staff`. Sets up an optional `www.`/`app.` subdomain split later with no back-end change. |
| 1.29.0 | Online prepayment + tipping: pickup/delivery guests now prepay by card at checkout with a tip (None/15/18/20/custom) and a full subtotal·service·tax·tip·total breakdown. Two-step Stripe flow (`/order/intent` → confirm card → `/order/confirm`) creates the paid order only after payment succeeds (idempotent; amount-verified in real mode); emails a receipt. Runs in simulated mode without Stripe keys. Dine-in QR still pays at the table. |
| 1.30.0 | Apple Pay / Google Pay + saved cards: checkout now uses the Stripe Payment Element (auto-offers Apple/Google Pay on supported devices). Signed-in customers can save a card (Stripe Customer; only brand/last4/expiry stored locally) and reuse it off-session on later orders, or manage cards under My Account → Payment Methods. Fully functional in simulated mode. |
| 1.31.0 | Delivery dispatch + driver tracking: new `driver` role + app; managers dispatch delivery orders to drivers with an ETA; drivers advance status (picked up → delivered/failed) and can share live GPS. Customers track the delivery timeline with driver name, ETA, and a live map. Deliveries have their own lifecycle; completing one closes the kitchen order. |
| 1.32.0 | SMS notifications (Twilio, simulated without keys): guests are texted on order received, payment received, ready for pickup, delivery on-the-way/delivered, and reservation request — whenever a phone is on file. Numbers normalized to E.164; simulated messages recorded in `sms_log`. |
| 1.33.0 | Pluggable SMS provider via `SMS_PROVIDER`: `simulated` (default), `twilio`, free **TextBelt**, or free **email-to-SMS carrier gateway** (reuses SMTP). `GET /api/public/sms-config` reports the active provider; `.env.example` documents all options. Real texts now possible without Twilio. |
| 1.34.0 | Optional Telegram ops notifier: a free bot posts new-order (incl. paid) and reservation alerts to a staff chat (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`); simulated to `telegram_log` when unconfigured; surfaced in `/api/public/sms-config` as `telegram_live`. |
| 1.35.0 | Self-service waitlist (virtual queue): guests join online (`waitlist.html`) and watch their live position + ETA; staff "Page" a party (texts them) and the guest's page flips to "table ready". New public endpoints + a staff page action; online joins flagged in the host queue. |
| 1.36.0 | Menu modifiers & combos: owners attach option groups (Size/Add-ons/Choose-a-side) with price deltas + min/max rules to menu items; a required group = a combo. Guests customize items at order time; the server validates + prices server-side and stores the chosen options, shown on kitchen tickets, tracking, and receipts. |
| 1.37.0 | Scheduled order-ahead + curbside: pickup/delivery guests choose ASAP or a future time (validated, shown to the kitchen); pickup orders can be curbside with a vehicle, and an "I'm here" arrival button alerts staff and flags the ticket. New `/order/arrived` endpoint. |
| 1.38.0 | Reservation deposits + guest CRM: owners set a deposit + min party size; qualifying public bookings prepay to hold the table (refundable by staff). New owner "Guests" CRM — searchable list with spend/visit/tier, per-guest VIP flag, tags, private notes, and order/reservation history. |
| 1.45.0 | **Bartender role + bar tabs: a new `bartender` role with a dedicated Bar Station runs open bar tabs — open by guest name (with a 🪪 ID-checked age-verification flag), add rounds from the Bar Menu (depletes liquor inventory via recipes), and Close & Settle through the shared payment flow (cash/card/mobile + tip). Bar tabs are orders (`order_type='bar'`, no table) so revenue flows into analytics automatically; the station also shows Bar Stock (low-stock) and lets the bartender 86 drinks. New `/api/bar/tabs` endpoints; `users.role` widened to include `bartender`; `orders.id_checked` column.** |
| 1.44.0 | **KDS course-firing + prep timers: kitchen tickets now control when each course starts cooking. Dine-in orders auto-fire the first course and hold the rest; the chef (or front-of-house) taps 🔥 Fire to send the next course to the line (or "Fire all remaining"), while to-go orders fire everything at once. Each fired course shows a live count-up prep timer (m:ss) against a per-item cook-time target (`prep_minutes`, configurable per menu item; per-course defaults otherwise) that turns amber then red ("LATE"). New `PUT /api/orders/:id/fire`; `order_items.fired_at`/`prep_minutes` + `menu_items.prep_minutes` columns; existing tickets backfilled as already-fired.** |
| 1.43.0 | **Feedback after any service: customers can now leave a star rating + comment straight after ordering online (on the order-placed screen and in the live tracker once complete) and after booking a reservation — not only from a dine-in receipt. A reusable widget (`/js/feedback.js`) posts to the generalized `POST /api/public/feedback`, which accepts a `tracking_code`, `reservation_code`, `receipt_code`, or `location_id` (general) and tags each review with its source. Owner & manager review lists show a source badge (Dine-in / Online order / Reservation / General) with the reference code.** |
| 1.42.0 | **Customer reviews + activity for managers, with date/location filters: customer feedback (saved from the receipt page) is now visible to managers too — a new manager "Activity & Reviews" tab shows their location's reviews and full activity log. Owner Guest Feedback and Audit Log gain Today/This-Week/This-Month period filters (audit also keeps its location filter); the manager view is automatically scoped to the manager's own location. New `start`/`end` query params on `GET /api/feedback` and `GET /api/audit`.** |
| 1.41.0 | **Notifications bell upgrade: each announcement + each owner/manager reply is a clickable item that opens a full-message popup and clears from the unread count (per-user read state, persisted); "Mark all read" included.** |
| 1.40.0 | **Universal announcements bell: every staff page (all roles) now shows a topbar bell listing announcements that apply to the viewer — owner-global + their location's manager posts — labeled by author role (Owner/Manager) with an unread count. Plus a manager Promotions tab and the waiter My Area/Tables split.** |
| 1.39.0 | **Promo codes + gift cards: owners/managers create %/$ promo codes (min, limit, window, location); guests apply them at online checkout (server-validated, discount before tax). Buyable stored-value gift cards (Stripe/sim) with emailed codes, balance tracking + ledger, and redemption at checkout (covers the order, partial or full).** |

---

*End of document.*
