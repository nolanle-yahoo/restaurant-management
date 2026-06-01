const db = require('./database');

function createSchema() {
  db.exec(`
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

    -- Loyalty ledger: points earned/redeemed, linked to the order that earned them.
    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      order_id INTEGER REFERENCES orders(id),
      points INTEGER NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Configurable permissions: which staff roles may perform sensitive actions.
    CREATE TABLE IF NOT EXISTS permissions (
      capability TEXT NOT NULL,
      role TEXT NOT NULL,
      allowed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(capability, role)
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
  try { db.exec(`ALTER TABLE payments ADD COLUMN discount REAL NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE payments ADD COLUMN manual_discount REAL NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE payments ADD COLUMN discount_reason TEXT`); } catch {}
  try { db.exec(`ALTER TABLE employee_messages ADD COLUMN parent_id INTEGER REFERENCES employee_messages(id)`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN voided INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN void_reason TEXT`); } catch {}
  try { db.exec(`ALTER TABLE customers ADD COLUMN referral_code TEXT`); } catch {}
  try { db.exec(`ALTER TABLE customers ADD COLUMN referred_by INTEGER REFERENCES customers(id)`); } catch {}

  // Seed default permissions (idempotent): managers may refund/void/discount;
  // owner is always allowed in code. Other roles default to not allowed.
  try {
    const insPerm = db.prepare(`INSERT OR IGNORE INTO permissions (capability, role, allowed) VALUES (?,?,?)`);
    [['refund','manager',1], ['void','manager',1], ['discount','manager',1],
     ['refund','waiter',0], ['void','waiter',0], ['discount','waiter',0],
     ['discount','employee',0], ['void','employee',0]].forEach(([c,r,a]) => insPerm.run(c,r,a));
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
