const db = require('./database');
const { createSchema } = require('./schema');
const bcrypt = require('bcryptjs');

createSchema();

function seed() {
  // Clear existing data and reset auto-increment counters
  db.exec(`
    DELETE FROM schedules; DELETE FROM supply_orders; DELETE FROM inventory_transactions;
    DELETE FROM inventory; DELETE FROM order_items; DELETE FROM orders;
    DELETE FROM tables; DELETE FROM clock_records; DELETE FROM users; DELETE FROM locations;
    DELETE FROM sqlite_sequence;
  `);

  // ── Locations ───────────────────────────────────────────────────
  const insertLoc = db.prepare(`INSERT INTO locations (name, address, phone, status) VALUES (?,?,?,?)`);
  insertLoc.run('Downtown Bistro',   '123 Main St, Downtown',     '(555) 100-0001', 'active');
  insertLoc.run('Uptown Grille',     '456 Park Ave, Uptown',      '(555) 100-0002', 'active');
  insertLoc.run('Airport Terminal',  '789 Airport Rd, Terminal 2','(555) 100-0003', 'active');
  insertLoc.run('Westside Kitchen',  '321 West Blvd, Westside',   '(555) 100-0004', 'active');
  insertLoc.run('Harbor View',       '654 Harbor Dr, Waterfront', '(555) 100-0005', 'active');

  // ── Users ────────────────────────────────────────────────────────
  const insertUser = db.prepare(`INSERT INTO users (name, email, password_hash, role, location_id, hourly_rate) VALUES (?,?,?,?,?,?)`);
  const h = (pw) => bcrypt.hashSync(pw, 10);

  // Owner (no location, salaried)
  insertUser.run('Alexandra Chen', 'owner@restaurant.com', h('owner123'), 'owner', null, 0);

  // Managers (one per location) — $25/hr
  insertUser.run('Marco Rivera',   'manager@downtown.com',  h('mgr123'),  'manager',   1, 25.00);
  insertUser.run('Priya Sharma',   'manager@uptown.com',    h('mgr123'),  'manager',   2, 25.00);
  insertUser.run('James Okafor',   'manager@airport.com',   h('mgr123'),  'manager',   3, 25.00);
  insertUser.run('Sofia Martinez', 'manager@westside.com',  h('mgr123'),  'manager',   4, 24.00);
  insertUser.run('Lena Kim',       'manager@harbor.com',    h('mgr123'),  'manager',   5, 25.00);

  // Stockroom controllers — $18/hr
  insertUser.run('David Park',     'stock@uptown.com',      h('stock123'),'stockroom', 2, 18.00);
  insertUser.run('Nina Patel',     'stock@downtown.com',    h('stock123'),'stockroom', 1, 18.00);

  // Chefs — $21–23/hr
  insertUser.run('Antonio Garcia', 'chef@downtown.com',     h('chef123'), 'chef',      1, 23.00);
  insertUser.run('Yuki Tanaka',    'chef@uptown.com',       h('chef123'), 'chef',      2, 22.00);
  insertUser.run('Olu Adeyemi',    'chef@airport.com',      h('chef123'), 'chef',      3, 21.00);
  insertUser.run('Rosa Mendez',    'chef@westside.com',     h('chef123'), 'chef',      4, 21.00);
  insertUser.run('Hans Mueller',   'chef@harbor.com',       h('chef123'), 'chef',      5, 23.00);

  // Waiters — $15/hr
  insertUser.run('Emily Johnson',  'waiter@downtown.com',   h('wait123'), 'waiter',    1, 15.00);
  insertUser.run('Carlos Diaz',    'waiter2@downtown.com',  h('wait123'), 'waiter',    1, 15.00);
  insertUser.run('Amara Nwosu',    'waiter@uptown.com',     h('wait123'), 'waiter',    2, 15.00);
  insertUser.run('Tom Baker',      'waiter@airport.com',    h('wait123'), 'waiter',    3, 14.50);

  // Front desk — $16/hr
  insertUser.run('Jessica Lee',    'desk@downtown.com',     h('desk123'), 'frontdesk', 1, 16.00);
  insertUser.run('Omar Hassan',    'desk@uptown.com',       h('desk123'), 'frontdesk', 2, 16.00);
  insertUser.run('Claire Dupont',  'desk@airport.com',      h('desk123'), 'frontdesk', 3, 16.00);

  // Employees — $13.50–14/hr
  insertUser.run('Ryan Torres',    'emp@downtown.com',      h('emp123'),  'employee',  1, 14.00);
  insertUser.run('Mia Wong',       'emp2@downtown.com',     h('emp123'),  'employee',  1, 14.00);
  insertUser.run('Ethan Brown',    'emp@uptown.com',        h('emp123'),  'employee',  2, 14.00);
  insertUser.run('Zara Ahmed',     'emp@airport.com',       h('emp123'),  'employee',  3, 13.50);
  insertUser.run('Lucas Silva',    'emp@westside.com',      h('emp123'),  'employee',  4, 13.50);
  insertUser.run('Aisha Diallo',   'emp@harbor.com',        h('emp123'),  'employee',  5, 14.00);

  // ── Tables ───────────────────────────────────────────────────────
  const insertTable = db.prepare(`INSERT INTO tables (location_id, table_number, capacity, status) VALUES (?,?,?,?)`);
  const tableStatuses = ['empty','waiting_order','ordered','waiting_food','ready_clean','cleaning','empty','empty'];
  [1,2,3,4,5].forEach(locId => {
    for (let t = 1; t <= 12; t++) {
      const cap = [2,4,4,6,4,4,2,6,4,4,6,4][t-1];
      const status = tableStatuses[(t + locId) % tableStatuses.length];
      insertTable.run(locId, t, cap, status);
    }
  });

  // ── Inventory ────────────────────────────────────────────────────
  const insertInv = db.prepare(`INSERT INTO inventory (location_id, item_name, category, unit, quantity, min_quantity) VALUES (?,?,?,?,?,?)`);
  const inventoryItems = [
    ['Beef Tenderloin',  'Meat',     'kg',    45,  20],
    ['Chicken Breast',   'Meat',     'kg',    60,  25],
    ['Atlantic Salmon',  'Seafood',  'kg',    8,   15],
    ['Shrimp',           'Seafood',  'kg',    30,  10],
    ['Roma Tomatoes',    'Produce',  'kg',    40,  15],
    ['Mixed Greens',     'Produce',  'kg',    5,   8],
    ['Potatoes',         'Produce',  'kg',    80,  30],
    ['Garlic',           'Produce',  'kg',    12,  5],
    ['Olive Oil',        'Pantry',   'liters',18,  10],
    ['Sea Salt',         'Pantry',   'kg',    20,  5],
    ['Black Pepper',     'Pantry',   'kg',    8,   3],
    ['Flour',            'Pantry',   'kg',    55,  20],
    ['Sugar',            'Pantry',   'kg',    30,  10],
    ['Butter',           'Dairy',    'kg',    25,  10],
    ['Heavy Cream',      'Dairy',    'liters',12,  8],
    ['Parmesan',         'Dairy',    'kg',    9,   5],
    ['Red Wine',         'Beverage', 'bottles',40, 15],
    ['White Wine',       'Beverage', 'bottles',35, 15],
    ['Sparkling Water',  'Beverage', 'cases', 20,  8],
    ['Coffee Beans',     'Beverage', 'kg',    15,  5],
  ];
  [1,2,3,4,5].forEach(locId => {
    inventoryItems.forEach(([name, cat, unit, qty, min]) => {
      // Vary quantities slightly per location
      const variance = (locId * 7 + name.length) % 20 - 10;
      insertInv.run(locId, name, cat, unit, Math.max(0, qty + variance), min);
    });
  });

  // ── Sample Orders ────────────────────────────────────────────────
  const insertOrder = db.prepare(`INSERT INTO orders (table_id, location_id, waiter_id, status, created_at) VALUES (?,?,?,?,datetime('now',?))`);
  const insertItem  = db.prepare(`INSERT INTO order_items (order_id, item_name, quantity, price) VALUES (?,?,?,?)`);

  const sampleOrders = [
    [2,  1, 13, 'pending',    '-8 minutes'],
    [3,  1, 13, 'preparing',  '-15 minutes'],
    [4,  1, 14, 'pending',    '-5 minutes'],
    [14, 2, 15, 'preparing',  '-20 minutes'],
    [15, 2, 15, 'ready',      '-30 minutes'],
    [26, 3, 16, 'pending',    '-3 minutes'],
  ];
  const menuItems = [
    ['Grilled Salmon', 32], ['Beef Tenderloin', 45], ['Chicken Marsala', 28],
    ['Caesar Salad', 14], ['Mushroom Risotto', 22], ['Shrimp Scampi', 30],
    ['Chocolate Lava Cake', 12], ['Tiramisu', 10], ['Sparkling Water', 5],
    ['House Red Wine', 12], ['Espresso', 6],
  ];
  sampleOrders.forEach(([tableId, locId, waiterId, status, offset]) => {
    const r = insertOrder.run(tableId, locId, waiterId, status, offset);
    const orderId = r.lastInsertRowid;
    const n = 2 + (orderId % 3);
    for (let i = 0; i < n; i++) {
      const item = menuItems[(orderId + i) % menuItems.length];
      insertItem.run(orderId, item[0], 1 + (i % 2), item[1]);
    }
  });

  // ── Clock Records ────────────────────────────────────────────────
  const insertClockOpen = db.prepare(`INSERT INTO clock_records (user_id, location_id, check_in) VALUES (?,?,datetime('now',?))`);
  const insertClock = db.prepare(`INSERT INTO clock_records (user_id, location_id, check_in, check_out, hours_worked) VALUES (?,?,datetime('now',?,?),datetime('now',?,?),?)`);

  // Recent open check-ins (still on duty)
  [[13,1,'-6 hours'],[14,1,'-5 hours'],[9,1,'-7 hours'],
   [17,1,'-4 hours'],[18,2,'-5 hours'],[10,2,'-6 hours']
  ].forEach(([uid,lid,ci]) => insertClockOpen.run(uid,lid,ci));

  // Past completed records this week
  for (let day = 1; day <= 5; day++) {
    [[13,1,8],[14,1,8],[9,1,8],[17,1,7],[22,1,6],
     [18,2,8],[15,2,7],[10,2,8],[19,2,6]
    ].forEach(([uid,lid,hrs]) => {
      insertClock.run(uid, lid, `-${day} days`, '-8 hours', `-${day} days`, `-${8-hrs} hours`, hrs);
    });
  }

  // ── Schedules ────────────────────────────────────────────────────
  const insertSched = db.prepare(`INSERT INTO schedules (user_id, location_id, work_date, shift_start, shift_end, created_by) VALUES (?,?,date('now',?),?,?,?)`);
  const shifts = [['08:00','16:00'],['12:00','20:00'],['16:00','00:00']];
  const downUsers = [13,14,9,17,22,21];
  downUsers.forEach((uid, i) => {
    for (let d = 0; d < 7; d++) {
      const shift = shifts[(i + d) % shifts.length];
      insertSched.run(uid, 1, `+${d} days`, shift[0], shift[1], 2);
    }
  });

  // ── Supply Orders ────────────────────────────────────────────────
  const insertSO = db.prepare(`
    INSERT INTO supply_orders (item_id, item_name, location_id, quantity, status, ordered_by, vendor, shipping_address, tracking_number, expected_date, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now',?))
  `);
  insertSO.run(3, 'Atlantic Salmon',  1, 20, 'pending',  9, 'Pacific Fresh Co.',      '123 Harbor Blvd, Seattle WA', null,       date(3),  '-1 days');
  insertSO.run(6, 'Mixed Greens',     1, 15, 'approved', 2, 'Green Valley Farms',     '456 Farm Rd, Salinas CA',     null,       date(5),  '-2 days');
  insertSO.run(17,'Red Wine',         2, 24, 'shipped',  3, 'Napa Valley Imports',    '789 Vine St, Napa CA',        'NVI-28341',date(2),  '-3 days');
  insertSO.run(8, 'Garlic',           3, 10, 'received', 4, 'Sun Valley Produce',     '321 Orchard Ln, Fresno CA',   null,       null,     '-4 days');
  insertSO.run(4, 'Shrimp',           4, 25, 'pending',  5, 'Gulf Coast Seafood LLC', '99 Marina Dr, Tampa FL',      null,       date(7),  '-1 days');
  insertSO.run(11,'Black Pepper',     5, 5,  'approved', 6, 'Spice World International','200 Trade Ave, Miami FL',   null,       date(4),  '-2 days');

  function date(daysAhead) {
    const d = new Date(); d.setDate(d.getDate() + daysAhead);
    return d.toISOString().slice(0,10);
  }

  // ── Transfer Requests ─────────────────────────────────────────────
  const insertTR = db.prepare(`
    INSERT INTO transfer_requests (item_name, quantity, from_location_id, to_location_id, requested_by, status, vendor, shipping_info, tracking_number, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now',?),datetime('now',?))
  `);
  insertTR.run('Beef Tenderloin', 10, 2, 1, 2,  'pending',    null,                     null,                        null,        'Needed for weekend banquet',  '-1 days', '-1 days');
  insertTR.run('Heavy Cream',     5,  3, 1, 4,  'approved',   null,                     'Refrigerated van delivery', null,        'For pastry station',          '-2 days', '-1 days');
  insertTR.run('Olive Oil',       8,  4, 3, 5,  'in_transit', null,                     'Driver: John (555-9201)',   'TRK-8821',  'Urgent — stock critical',     '-3 days', '-1 days');
  insertTR.run('Coffee Beans',    3,  5, 2, 6,  'received',   'Artisan Roasters Inc.',  'Standard ground shipping',  'AR-44120',  null,                          '-5 days', '-2 days');
  insertTR.run('Parmesan',        4,  1, 5, 9,  'pending',    null,                     null,                        null,        'For new pasta menu items',    '-1 days', '-1 days');

  console.log('✅  Database seeded successfully!');
  console.log('');
  console.log('Demo login accounts:');
  console.log('  owner@restaurant.com  / owner123   (Owner - all locations)');
  console.log('  manager@downtown.com  / mgr123     (Manager - Downtown Bistro)');
  console.log('  chef@downtown.com     / chef123    (Chef - Downtown Bistro)');
  console.log('  waiter@downtown.com   / wait123    (Waiter - Downtown Bistro)');
  console.log('  desk@downtown.com     / desk123    (Front Desk - Downtown Bistro)');
  console.log('  emp@downtown.com      / emp123     (Employee - Downtown Bistro)');
  console.log('  stock@uptown.com      / stock123   (Stockroom - Uptown Grille)');
}

seed();
