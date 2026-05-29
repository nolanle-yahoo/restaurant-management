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
  `);

  // Column migrations
  try { db.exec(`ALTER TABLE users ADD COLUMN hourly_rate REAL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE supply_orders ADD COLUMN item_name TEXT`); } catch {}
  try { db.exec(`ALTER TABLE supply_orders ADD COLUMN vendor TEXT`); } catch {}
  try { db.exec(`ALTER TABLE supply_orders ADD COLUMN shipping_address TEXT`); } catch {}
  try { db.exec(`ALTER TABLE supply_orders ADD COLUMN tracking_number TEXT`); } catch {}
  try { db.exec(`ALTER TABLE supply_orders ADD COLUMN expected_date TEXT`); } catch {}

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
}

module.exports = { createSchema };
