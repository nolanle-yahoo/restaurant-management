const db = require('./database');

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS regions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','manager','stockroom','employee','frontdesk','waiter','chef')),
      location_id INTEGER REFERENCES locations(id),
      hourly_rate REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clock_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      location_id INTEGER REFERENCES locations(id),
      check_in TEXT NOT NULL,
      check_out TEXT,
      hours_worked REAL
    );

    CREATE TABLE IF NOT EXISTS areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6B1A1A',
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      table_number INTEGER NOT NULL,
      capacity INTEGER DEFAULT 4,
      area_id INTEGER REFERENCES areas(id),
      status TEXT DEFAULT 'empty'
    );

    CREATE TABLE IF NOT EXISTS waiter_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      area_id INTEGER NOT NULL REFERENCES areas(id),
      assigned_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, area_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL REFERENCES tables(id),
      location_id INTEGER NOT NULL REFERENCES locations(id),
      waiter_id INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','served')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      item_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      notes TEXT,
      price REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      item_name TEXT NOT NULL,
      category TEXT,
      unit TEXT DEFAULT 'units',
      quantity REAL DEFAULT 0,
      min_quantity REAL DEFAULT 10,
      last_updated TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES inventory(id),
      from_location_id INTEGER REFERENCES locations(id),
      to_location_id INTEGER REFERENCES locations(id),
      quantity REAL NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('in','out','transfer_request','transfer_sent')),
      user_id INTEGER REFERENCES users(id),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supply_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES inventory(id),
      location_id INTEGER NOT NULL REFERENCES locations(id),
      quantity REAL NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','shipped','received')),
      ordered_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      location_id INTEGER NOT NULL REFERENCES locations(id),
      work_date TEXT NOT NULL,
      shift_start TEXT NOT NULL,
      shift_end TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS shift_swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL REFERENCES schedules(id),
      requester_id INTEGER NOT NULL REFERENCES users(id),
      location_id INTEGER NOT NULL REFERENCES locations(id),
      target_user_id INTEGER REFERENCES users(id),
      accepted_by INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','approved','rejected','cancelled')),
      note TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      decided_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transfer_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      from_location_id INTEGER NOT NULL REFERENCES locations(id),
      to_location_id INTEGER NOT NULL REFERENCES locations(id),
      requested_by INTEGER NOT NULL REFERENCES users(id),
      approved_by INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','in_transit','received','cancelled')),
      vendor TEXT,
      shipping_info TEXT,
      tracking_number TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS time_off_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      location_id INTEGER REFERENCES locations(id),
      type TEXT NOT NULL CHECK(type IN ('vacation','sick','personal','other')),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','cancelled')),
      reviewed_by INTEGER REFERENCES users(id),
      review_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employee_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      location_id INTEGER REFERENCES locations(id),
      recipient_type TEXT NOT NULL DEFAULT 'manager' CHECK(recipient_type IN ('manager','owner','both')),
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      guest_name TEXT NOT NULL,
      guest_phone TEXT,
      guest_email TEXT,
      party_size INTEGER NOT NULL DEFAULT 2,
      reservation_date TEXT NOT NULL,
      reservation_time TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 90,
      table_id INTEGER REFERENCES tables(id),
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed','seated','completed','no_show','cancelled')),
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS menu_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER REFERENCES locations(id),
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES menu_categories(id),
      location_id INTEGER REFERENCES locations(id),
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL DEFAULT 0,
      is_available INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      user_name TEXT,
      user_role TEXT,
      location_id INTEGER REFERENCES locations(id),
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      location_id INTEGER REFERENCES locations(id),
      waiter_id INTEGER REFERENCES users(id),
      subtotal REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      tip REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'card' CHECK(method IN ('card','cash','mobile')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','refunded','failed')),
      stripe_payment_intent_id TEXT,
      processed_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS telegram_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT,
      body TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','simulated','failed')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sms_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_number TEXT,
      body TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','simulated','failed')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT,
      subject TEXT,
      body TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','simulated','failed')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Global key/value settings (e.g., sales-tax and service-charge rates).
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Menu modifiers: option groups attached to a menu item (e.g. Size, Add-ons,
    -- Protein) and the selectable options within each (with a price delta). A
    -- "combo" is just an item with one or more required groups (min_select >= 1).
    CREATE TABLE IF NOT EXISTS modifier_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      name TEXT NOT NULL,
      min_select INTEGER NOT NULL DEFAULT 0,
      max_select INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS modifier_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES modifier_groups(id),
      name TEXT NOT NULL,
      price_delta REAL NOT NULL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      is_available INTEGER NOT NULL DEFAULT 1
    );

    -- Recipe / bill-of-materials: how much of each inventory item a menu item consumes.
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      inventory_id INTEGER NOT NULL REFERENCES inventory(id),
      quantity REAL NOT NULL DEFAULT 0,
      UNIQUE(menu_item_id, inventory_id)
    );

    -- Customer accounts (separate from staff users): loyalty points + marketing opt-in.
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      marketing_opt_in INTEGER NOT NULL DEFAULT 0,
      unsubscribe_token TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Saved payment methods for signed-in customers (card brand/last4 + the Stripe
    -- PaymentMethod id; the actual card data lives in Stripe, never here).
    CREATE TABLE IF NOT EXISTS customer_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      stripe_pm_id TEXT NOT NULL,
      brand TEXT,
      last4 TEXT,
      exp_month INTEGER,
      exp_year INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(customer_id, stripe_pm_id)
    );

    -- Loyalty ledger: points earned/redeemed, linked to the order that earned them.
    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      order_id INTEGER REFERENCES orders(id),
      points INTEGER NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Walk-in waitlist (host queue alongside reservations).
    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      guest_name TEXT NOT NULL,
      party_size INTEGER NOT NULL DEFAULT 2,
      phone TEXT,
      quoted_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','seated','left')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      seated_at TEXT
    );

    -- Cycle counts: physical inventory reconciliation with variance.
    CREATE TABLE IF NOT EXISTS cycle_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES inventory(id),
      location_id INTEGER REFERENCES locations(id),
      system_qty REAL NOT NULL,
      counted_qty REAL NOT NULL,
      variance REAL NOT NULL,
      user_id INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Staff certifications (e.g., food handler) with expiry tracking.
    CREATE TABLE IF NOT EXISTS certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      issued_date TEXT,
      expiry_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Vendor master records for supply ordering.
    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      email TEXT,
      lead_time_days INTEGER DEFAULT 0,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Waste / spoilage log: stock written off with a reason.
    CREATE TABLE IF NOT EXISTS waste_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES inventory(id),
      location_id INTEGER REFERENCES locations(id),
      quantity REAL NOT NULL,
      reason TEXT,
      user_id INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Post-visit guest feedback, tied to a settled payment's receipt.
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_code TEXT,
      order_id INTEGER REFERENCES orders(id),
      location_id INTEGER REFERENCES locations(id),
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Configurable permissions: which staff roles may perform sensitive actions.
    CREATE TABLE IF NOT EXISTS permissions (
      capability TEXT NOT NULL,
      role TEXT NOT NULL,
      allowed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(capability, role)
    );

    -- Inventory lots: received batches with expiry dates. Stock is consumed FIFO
    -- (earliest expiry first) so older stock is used before it spoils.
    CREATE TABLE IF NOT EXISTS inventory_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES inventory(id),
      location_id INTEGER REFERENCES locations(id),
      lot_code TEXT,
      received_qty REAL NOT NULL,
      quantity REAL NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0,
      expiry_date TEXT,
      received_by INTEGER REFERENCES users(id),
      received_at TEXT DEFAULT (datetime('now')),
      depleted_at TEXT
    );

    -- Delivery dispatch + driver tracking for delivery orders. One row per delivery
    -- order, with its own lifecycle (separate from the kitchen order status) and the
    -- assigned driver's latest location for live tracking.
    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      location_id INTEGER REFERENCES locations(id),
      driver_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','assigned','picked_up','delivered','failed')),
      eta_minutes INTEGER,
      driver_lat REAL,
      driver_lng REAL,
      location_updated_at TEXT,
      notes TEXT,
      assigned_at TEXT,
      picked_up_at TEXT,
      delivered_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(order_id)
    );

    -- Cross-location staff lending: temporarily reassign a staff member to another
    -- location. While active the user's location_id points to the borrowing location;
    -- returning restores their home_location_id.
    CREATE TABLE IF NOT EXISTS staff_loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      from_location_id INTEGER REFERENCES locations(id),
      to_location_id INTEGER NOT NULL REFERENCES locations(id),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','returned')),
      note TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      returned_at TEXT
    );

    -- Promo / discount codes applied at checkout.
    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'percent' CHECK(kind IN ('percent','amount')),
      value REAL NOT NULL DEFAULT 0,
      min_subtotal REAL NOT NULL DEFAULT 0,
      starts_at TEXT,
      ends_at TEXT,
      usage_limit INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      location_id INTEGER REFERENCES locations(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Stored-value gift cards (balance lives here; ledger in gift_card_txns).
    CREATE TABLE IF NOT EXISTS gift_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      initial_amount REAL NOT NULL,
      balance REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
      purchaser_email TEXT,
      recipient_email TEXT,
      message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS gift_card_txns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gift_card_id INTEGER NOT NULL REFERENCES gift_cards(id),
      amount REAL NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Broadcast announcements from owner/manager to staff (location-scoped or global).
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER REFERENCES locations(id),
      author_id INTEGER REFERENCES users(id),
      author_name TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Column migrations
  try { db.exec(`ALTER TABLE users ADD COLUMN hourly_rate REAL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE reservations ADD COLUMN confirmation_code TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payments ADD COLUMN receipt_code TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payments ADD COLUMN receipt_email TEXT`); } catch {}
  try { db.exec(`ALTER TABLE supply_orders ADD COLUMN item_name TEXT`); } catch {}
  try { db.exec(`ALTER TABLE supply_orders ADD COLUMN vendor TEXT`); } catch {}
  try { db.exec(`ALTER TABLE supply_orders ADD COLUMN shipping_address TEXT`); } catch {}
  try { db.exec(`ALTER TABLE supply_orders ADD COLUMN tracking_number TEXT`); } catch {}
  try { db.exec(`ALTER TABLE supply_orders ADD COLUMN expected_date TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payments ADD COLUMN service_charge REAL NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE reservations ADD COLUMN reminded INTEGER DEFAULT 0`); } catch {}
  // Online ordering: orders can be customer pickup/delivery (no table/waiter).
  try { db.exec(`ALTER TABLE orders ADD COLUMN order_type TEXT NOT NULL DEFAULT 'dine_in'`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN customer_name TEXT`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN customer_phone TEXT`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN customer_email TEXT`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN delivery_address TEXT`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN tracking_code TEXT`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id)`); } catch {}
  // Feedback can now be left after any service (online order, reservation) — not just a
  // settled receipt — so track where it came from and which booking/order it references.
  try { db.exec(`ALTER TABLE feedback ADD COLUMN source TEXT DEFAULT 'receipt'`); } catch {}
  try { db.exec(`ALTER TABLE feedback ADD COLUMN reference_code TEXT`); } catch {}
  try { db.exec(`ALTER TABLE feedback ADD COLUMN customer_name TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payments ADD COLUMN discount REAL NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE payments ADD COLUMN manual_discount REAL NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE payments ADD COLUMN discount_reason TEXT`); } catch {}
  try { db.exec(`ALTER TABLE employee_messages ADD COLUMN parent_id INTEGER REFERENCES employee_messages(id)`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN voided INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN void_reason TEXT`); } catch {}
  try { db.exec(`ALTER TABLE customers ADD COLUMN referral_code TEXT`); } catch {}
  try { db.exec(`ALTER TABLE customers ADD COLUMN stripe_customer_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE customers ADD COLUMN referred_by INTEGER REFERENCES customers(id)`); } catch {}
  try { db.exec(`ALTER TABLE menu_items ADD COLUMN image_url TEXT`); } catch {}
  try { db.exec(`ALTER TABLE menu_items ADD COLUMN allergens TEXT`); } catch {}
  try { db.exec(`ALTER TABLE menu_items ADD COLUMN dietary TEXT`); } catch {}
  try { db.exec(`ALTER TABLE supply_orders ADD COLUMN vendor_id INTEGER REFERENCES vendors(id)`); } catch {}
  try { db.exec(`ALTER TABLE order_items ADD COLUMN course TEXT`); } catch {}
  try { db.exec(`ALTER TABLE inventory ADD COLUMN sku TEXT`); } catch {}
  try { db.exec(`ALTER TABLE inventory ADD COLUMN unit_cost REAL NOT NULL DEFAULT 0`); } catch {}
  // Self-service waitlist (virtual queue): guests join online via a public code,
  // and staff can "page" them when their table is ready.
  try { db.exec(`ALTER TABLE waitlist ADD COLUMN public_code TEXT`); } catch {}
  try { db.exec(`ALTER TABLE waitlist ADD COLUMN notified_at TEXT`); } catch {}
  // Chosen modifiers summary for an order line (human-readable).
  try { db.exec(`ALTER TABLE order_items ADD COLUMN modifiers TEXT`); } catch {}
  // Reservation deposits (card hold to reduce no-shows).
  try { db.exec(`ALTER TABLE reservations ADD COLUMN deposit_amount REAL NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE reservations ADD COLUMN deposit_status TEXT NOT NULL DEFAULT 'none'`); } catch {}
  try { db.exec(`ALTER TABLE reservations ADD COLUMN deposit_intent TEXT`); } catch {}
  // Guest CRM: per-customer notes, tags, and a VIP flag.
  try { db.exec(`ALTER TABLE customers ADD COLUMN tags TEXT`); } catch {}
  try { db.exec(`ALTER TABLE customers ADD COLUMN notes TEXT`); } catch {}
  try { db.exec(`ALTER TABLE customers ADD COLUMN vip INTEGER NOT NULL DEFAULT 0`); } catch {}
  // Scheduled order-ahead + curbside pickup.
  try { db.exec(`ALTER TABLE orders ADD COLUMN scheduled_for TEXT`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN curbside INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN vehicle TEXT`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN arrived_at TEXT`); } catch {}
  // Central menu with per-location overrides: location rows link to a central
  // (location_id IS NULL) template via central_id; price_overridden=1 protects a
  // locally-edited price from being reset on the next central sync.
  try { db.exec(`ALTER TABLE menu_categories ADD COLUMN central_id INTEGER REFERENCES menu_categories(id)`); } catch {}
  try { db.exec(`ALTER TABLE menu_items ADD COLUMN central_id INTEGER REFERENCES menu_items(id)`); } catch {}
  try { db.exec(`ALTER TABLE menu_items ADD COLUMN price_overridden INTEGER NOT NULL DEFAULT 0`); } catch {}
  // Direct table-to-staff assignment (managers assign; waiters can claim a free table).
  try { db.exec(`ALTER TABLE tables ADD COLUMN assigned_to INTEGER REFERENCES users(id)`); } catch {}
  // Regions & cross-location staff lending.
  try { db.exec(`ALTER TABLE locations ADD COLUMN region_id INTEGER REFERENCES regions(id)`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN region_id INTEGER REFERENCES regions(id)`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN home_location_id INTEGER REFERENCES locations(id)`); } catch {}

  // Seed default permissions (idempotent): managers may refund/void/discount;
  // owner is always allowed in code. Other roles default to not allowed.
  try {
    const insPerm = db.prepare(`INSERT OR IGNORE INTO permissions (capability, role, allowed) VALUES (?,?,?)`);
    [['refund','manager',1], ['void','manager',1], ['discount','manager',1],
     ['refund','waiter',0], ['void','waiter',0], ['discount','waiter',0],
     ['discount','employee',0], ['void','employee',0]].forEach(([c,r,a]) => insPerm.run(c,r,a));
  } catch {}

  // Backfill referral codes for any customers created before the column existed.
  try {
    const crypto = require('crypto');
    const need = db.prepare(`SELECT id FROM customers WHERE referral_code IS NULL`).all();
    const upd = db.prepare(`UPDATE customers SET referral_code=? WHERE id=?`);
    need.forEach(c => upd.run('REF-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6), c.id));
  } catch {}

  // Migrate tables table: remove old CHECK constraint, add area_id
  try {
    const cols = db.prepare('PRAGMA table_info(tables)').all().map(c => c.name);
    if (!cols.includes('area_id')) {
      db.exec(`PRAGMA foreign_keys = OFF`);
      db.exec(`
        CREATE TABLE tables_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id INTEGER NOT NULL REFERENCES locations(id),
          table_number INTEGER NOT NULL,
          capacity INTEGER DEFAULT 4,
          area_id INTEGER REFERENCES areas(id),
          status TEXT DEFAULT 'empty'
        )
      `);
      db.exec(`INSERT INTO tables_new(id,location_id,table_number,capacity,status) SELECT id,location_id,table_number,capacity,status FROM tables`);
      db.exec(`DROP TABLE tables`);
      db.exec(`ALTER TABLE tables_new RENAME TO tables`);
      db.exec(`PRAGMA foreign_keys = ON`);
    }
  } catch(e) { db.exec(`PRAGMA foreign_keys = ON`); }

  // Widen users.role CHECK to include 'regional' and 'driver'. Guarded
  // table-rebuild preserving ids so existing FK references stay valid.
  try {
    const ddl = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`).get();
    if (ddl && !ddl.sql.includes("'driver'")) {
      db.exec(`PRAGMA foreign_keys = OFF`);
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('owner','regional','manager','stockroom','employee','frontdesk','waiter','chef','driver')),
          location_id INTEGER REFERENCES locations(id),
          hourly_rate REAL DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          token_version INTEGER DEFAULT 0,
          region_id INTEGER REFERENCES regions(id),
          home_location_id INTEGER REFERENCES locations(id)
        )
      `);
      const newCols = ['id','name','email','password_hash','role','location_id','hourly_rate','is_active','created_at','token_version','region_id','home_location_id'];
      const have = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
      const copy = newCols.filter(c => have.includes(c)).join(',');
      db.exec(`INSERT INTO users_new (${copy}) SELECT ${copy} FROM users`);
      db.exec(`DROP TABLE users`);
      db.exec(`ALTER TABLE users_new RENAME TO users`);
      db.exec(`PRAGMA foreign_keys = ON`);
    }
  } catch (e) { db.exec(`PRAGMA foreign_keys = ON`); }

  // Backfill each user's home location to their current location.
  try { db.exec(`UPDATE users SET home_location_id = location_id WHERE home_location_id IS NULL`); } catch {}

  // Migrate orders: make table_id nullable so online (pickup/delivery) orders,
  // which have no table, can be stored alongside dine-in orders.
  try {
    const tcol = db.prepare('PRAGMA table_info(orders)').all().find(c => c.name === 'table_id');
    if (tcol && tcol.notnull === 1) {
      db.exec(`PRAGMA foreign_keys = OFF`);
      db.exec(`
        CREATE TABLE orders_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          table_id INTEGER REFERENCES tables(id),
          location_id INTEGER NOT NULL REFERENCES locations(id),
          waiter_id INTEGER REFERENCES users(id),
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','served')),
          notes TEXT,
          order_type TEXT NOT NULL DEFAULT 'dine_in',
          customer_id INTEGER REFERENCES customers(id),
          customer_name TEXT,
          customer_phone TEXT,
          customer_email TEXT,
          delivery_address TEXT,
          tracking_code TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec(`INSERT INTO orders_new
        (id,table_id,location_id,waiter_id,status,notes,order_type,customer_id,customer_name,customer_phone,customer_email,delivery_address,tracking_code,created_at,updated_at)
        SELECT id,table_id,location_id,waiter_id,status,notes,order_type,customer_id,customer_name,customer_phone,customer_email,delivery_address,tracking_code,created_at,updated_at FROM orders`);
      db.exec(`DROP TABLE orders`);
      db.exec(`ALTER TABLE orders_new RENAME TO orders`);
      db.exec(`PRAGMA foreign_keys = ON`);
    }
  } catch(e) { db.exec(`PRAGMA foreign_keys = ON`); }
}

module.exports = { createSchema };
