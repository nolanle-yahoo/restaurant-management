const db = require('./database');
const { createSchema } = require('./schema');
const bcrypt = require('bcryptjs');

createSchema();

function seed() {
  db.exec(`
    DELETE FROM audit_log;
    DELETE FROM feedback;
    DELETE FROM announcements;
    DELETE FROM employee_messages; DELETE FROM time_off_requests;
    DELETE FROM reservations;
    DELETE FROM waitlist;
    DELETE FROM recipes; DELETE FROM settings;
    DELETE FROM menu_items; DELETE FROM menu_categories;
    DELETE FROM waiter_assignments; DELETE FROM shift_swaps; DELETE FROM schedules;
    DELETE FROM staff_loans;
    DELETE FROM supply_orders; DELETE FROM inventory_transactions; DELETE FROM transfer_requests;
    DELETE FROM waste_log; DELETE FROM cycle_counts; DELETE FROM vendors;
    DELETE FROM inventory_lots;
    DELETE FROM certifications;
    DELETE FROM payments; DELETE FROM email_log; DELETE FROM password_reset_tokens;
    DELETE FROM loyalty_transactions; DELETE FROM customer_cards;
    DELETE FROM inventory; DELETE FROM order_items; DELETE FROM orders;
    UPDATE customers SET referred_by=NULL;
    DELETE FROM customers;
    DELETE FROM tables; DELETE FROM areas; DELETE FROM clock_records; DELETE FROM users; DELETE FROM locations;
    DELETE FROM regions;
    DELETE FROM sqlite_sequence;
  `);

  // ── Locations ───────────────────────────────────────────────────
  const insertLoc = db.prepare(`INSERT INTO locations (name, address, phone, status) VALUES (?,?,?,?)`);
  insertLoc.run('Downtown Bistro',   '123 Main St, Downtown',     '(555) 100-0001', 'active');
  insertLoc.run('Uptown Grille',     '456 Park Ave, Uptown',      '(555) 100-0002', 'active');
  insertLoc.run('Airport Terminal',  '789 Airport Rd, Terminal 2','(555) 100-0003', 'active');
  insertLoc.run('Westside Kitchen',  '321 West Blvd, Westside',   '(555) 100-0004', 'active');
  insertLoc.run('Harbor View',       '654 Harbor Dr, Waterfront', '(555) 100-0005', 'active');

  // ── Regions ──────────────────────────────────────────────────────
  // East: Downtown(1), Uptown(2), Harbor(5). West: Airport(3), Westside(4).
  const insertRegion = db.prepare(`INSERT INTO regions (name) VALUES (?)`);
  const eastId = insertRegion.run('East Region').lastInsertRowid;
  const westId = insertRegion.run('West Region').lastInsertRowid;
  const setLocRegion = db.prepare(`UPDATE locations SET region_id=? WHERE id=?`);
  [[eastId,1],[eastId,2],[eastId,5],[westId,3],[westId,4]].forEach(([r,l]) => setLocRegion.run(r,l));

  // ── Users ────────────────────────────────────────────────────────
  const insertUser = db.prepare(`INSERT INTO users (name, email, password_hash, role, location_id, hourly_rate) VALUES (?,?,?,?,?,?)`);
  const h = (pw) => bcrypt.hashSync(pw, 10);

  insertUser.run('Nolan Le',       'owner@restaurant.com', h('owner123'), 'owner',     null, 0);
  insertUser.run('Marco Rivera',   'manager@downtown.com', h('mgr123'),  'manager',   1, 25.00);
  insertUser.run('Priya Sharma',   'manager@uptown.com',   h('mgr123'),  'manager',   2, 25.00);
  insertUser.run('James Okafor',   'manager@airport.com',  h('mgr123'),  'manager',   3, 25.00);
  insertUser.run('Sofia Martinez', 'manager@westside.com', h('mgr123'),  'manager',   4, 24.00);
  insertUser.run('Lena Kim',       'manager@harbor.com',   h('mgr123'),  'manager',   5, 25.00);
  insertUser.run('David Park',     'stock@uptown.com',     h('stock123'),'stockroom', 2, 18.00);
  insertUser.run('Nina Patel',     'stock@downtown.com',   h('stock123'),'stockroom', 1, 18.00);
  insertUser.run('Antonio Garcia', 'chef@downtown.com',    h('chef123'), 'chef',      1, 23.00);
  insertUser.run('Yuki Tanaka',    'chef@uptown.com',      h('chef123'), 'chef',      2, 22.00);
  insertUser.run('Olu Adeyemi',    'chef@airport.com',     h('chef123'), 'chef',      3, 21.00);
  insertUser.run('Rosa Mendez',    'chef@westside.com',    h('chef123'), 'chef',      4, 21.00);
  insertUser.run('Hans Mueller',   'chef@harbor.com',      h('chef123'), 'chef',      5, 23.00);
  insertUser.run('Emily Johnson',  'waiter@downtown.com',  h('wait123'), 'waiter',    1, 15.00); // id 14
  insertUser.run('Carlos Diaz',    'waiter2@downtown.com', h('wait123'), 'waiter',    1, 15.00); // id 15
  insertUser.run('Amara Nwosu',    'waiter@uptown.com',    h('wait123'), 'waiter',    2, 15.00); // id 16
  insertUser.run('Tom Baker',      'waiter@airport.com',   h('wait123'), 'waiter',    3, 14.50); // id 17
  insertUser.run('Jessica Lee',    'desk@downtown.com',    h('desk123'), 'frontdesk', 1, 16.00);
  insertUser.run('Omar Hassan',    'desk@uptown.com',      h('desk123'), 'frontdesk', 2, 16.00);
  insertUser.run('Claire Dupont',  'desk@airport.com',     h('desk123'), 'frontdesk', 3, 16.00);
  insertUser.run('Ryan Torres',    'emp@downtown.com',     h('emp123'),  'employee',  1, 14.00);
  insertUser.run('Mia Wong',       'emp2@downtown.com',    h('emp123'),  'employee',  1, 14.00);
  insertUser.run('Ethan Brown',    'emp@uptown.com',       h('emp123'),  'employee',  2, 14.00);
  insertUser.run('Zara Ahmed',     'emp@airport.com',      h('emp123'),  'employee',  3, 13.50);
  insertUser.run('Lucas Silva',    'emp@westside.com',     h('emp123'),  'employee',  4, 13.50);
  insertUser.run('Aisha Diallo',   'emp@harbor.com',       h('emp123'),  'employee',  5, 14.00);

  // Regional manager over the East Region (home base: Downtown).
  db.prepare(`INSERT INTO users (name, email, password_hash, role, location_id, region_id, hourly_rate) VALUES (?,?,?,?,?,?,?)`)
    .run('Grace Mbeki', 'regional@east.com', h('region123'), 'regional', 1, eastId, 32.00);
  // Delivery drivers (Downtown).
  insertUser.run('Diego Ramirez', 'driver@downtown.com',  h('driver123'), 'driver', 1, 16.00);
  insertUser.run('Tara Singh',    'driver2@downtown.com', h('driver123'), 'driver', 1, 16.00);
  // Each user's home location starts as their assigned location.
  db.prepare(`UPDATE users SET home_location_id=location_id WHERE home_location_id IS NULL`).run();

  // ── Demo customer account (loyalty + marketing) ─────────────────
  const crypto = require('crypto');
  db.prepare(`INSERT INTO customers (name, email, phone, password_hash, points, marketing_opt_in, unsubscribe_token) VALUES (?,?,?,?,?,?,?)`)
    .run('Demo Diner', 'diner@example.com', '(555) 300-0001', h('diner123'), 120, 1, crypto.randomBytes(16).toString('hex'));

  // ── Areas (4 per location) ───────────────────────────────────────
  const insertArea = db.prepare(`INSERT INTO areas (location_id, name, color, sort_order) VALUES (?,?,?,?)`);
  const areaColors = ['#6B1A1A', '#4A7C59', '#C9A84C', '#4C86C9'];
  const areaNames  = ['Main Hall', 'Patio & Terrace', 'Bar Area', 'Private Dining'];
  // area IDs: loc1 → 1-4, loc2 → 5-8, loc3 → 9-12, loc4 → 13-16, loc5 → 17-20
  [1,2,3,4,5].forEach(locId => {
    areaNames.forEach((name, i) => insertArea.run(locId, name, areaColors[i], i));
  });

  // ── Tables (12 per location, assigned to areas) ──────────────────
  const insertTable = db.prepare(`INSERT INTO tables (location_id, table_number, capacity, area_id, status) VALUES (?,?,?,?,?)`);
  const capacities = [2,4,4,6,4, 4,2,6, 4,4, 6,4];
  // area offset within location: tables 1-5 → area 0, 6-8 → area 1, 9-10 → area 2, 11-12 → area 3
  function tableAreaIndex(t) {
    if (t <= 5)  return 0;
    if (t <= 8)  return 1;
    if (t <= 10) return 2;
    return 3;
  }
  const allStatuses = ['empty','occupied','waiting_order','ordered','waiting_food','need_help','waiting_payment','special_request','ready_clean','cleaning'];
  [1,2,3,4,5].forEach(locId => {
    for (let t = 1; t <= 12; t++) {
      const areaId = (locId - 1) * 4 + tableAreaIndex(t) + 1;
      const status = allStatuses[(t + locId * 3) % allStatuses.length];
      insertTable.run(locId, t, capacities[t-1], areaId, status);
    }
  });

  // ── Waiter Assignments ───────────────────────────────────────────
  const insertAssign = db.prepare(`INSERT INTO waiter_assignments (user_id, area_id, assigned_by) VALUES (?,?,?)`);
  // Emily Johnson (14) → Main Hall loc1 (area 1), assigned by manager Marco (2)
  insertAssign.run(14, 1, 2);
  // Carlos Diaz (15) → Patio loc1 (area 2)
  insertAssign.run(15, 2, 2);
  // Amara Nwosu (16) → Main Hall loc2 (area 5), assigned by Priya (3)
  insertAssign.run(16, 5, 3);
  // Tom Baker (17) → Main Hall loc3 (area 9), assigned by James (4)
  insertAssign.run(17, 9, 4);

  // ── Sample Orders ────────────────────────────────────────────────
  const insertOrder = db.prepare(`INSERT INTO orders (table_id, location_id, waiter_id, status, created_at) VALUES (?,?,?,?,datetime('now',?))`);
  const insertItem  = db.prepare(`INSERT INTO order_items (order_id, item_name, quantity, price) VALUES (?,?,?,?)`);
  const menuItems = [
    ['Grilled Salmon', 32], ['Beef Tenderloin', 45], ['Chicken Marsala', 28],
    ['Caesar Salad', 14], ['Mushroom Risotto', 22], ['Shrimp Scampi', 30],
    ['Chocolate Lava Cake', 12], ['Tiramisu', 10], ['Sparkling Water', 5],
    ['House Red Wine', 12], ['Espresso', 6],
  ];
  const sampleOrders = [
    [2,  1, 14, 'pending',   '-8 minutes'],
    [3,  1, 14, 'preparing', '-15 minutes'],
    [4,  1, 15, 'pending',   '-5 minutes'],
    [14, 2, 16, 'preparing', '-20 minutes'],
    [15, 2, 16, 'ready',     '-30 minutes'],
    [26, 3, 17, 'pending',   '-3 minutes'],
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

  // ── Sample delivery orders (for the dispatch board) ──────────────
  const insDelivOrder = db.prepare(`INSERT INTO orders (location_id, status, order_type, customer_name, customer_phone, customer_email, delivery_address, tracking_code, created_at) VALUES (?, 'ready', 'delivery', ?, ?, ?, ?, ?, datetime('now', ?))`);
  const insDeliv = db.prepare(`INSERT INTO deliveries (order_id, location_id, status) VALUES (?,?,'pending')`);
  [
    ['Jordan Reese', '(555) 222-0101', 'jordan@example.com', '120 Oak St, Apt 4, Downtown', 'ORD-DLV001', '-14 minutes'],
    ['Sam Patel',    '(555) 222-0144', 'sam@example.com',    '88 Birch Ave, Downtown',      'ORD-DLV002', '-6 minutes'],
  ].forEach(([nm, ph, em, addr, code, off]) => {
    const r = insDelivOrder.run(1, nm, ph, em, addr, code, off);
    for (let i = 0; i < 2; i++) { const it = menuItems[(r.lastInsertRowid + i) % menuItems.length]; insertItem.run(r.lastInsertRowid, it[0], 1, it[1]); }
    insDeliv.run(r.lastInsertRowid, 1);
  });

  // ── Clock Records ────────────────────────────────────────────────
  const insertClockOpen = db.prepare(`INSERT INTO clock_records (user_id, location_id, check_in) VALUES (?,?,datetime('now',?))`);
  const insertClock     = db.prepare(`INSERT INTO clock_records (user_id, location_id, check_in, check_out, hours_worked) VALUES (?,?,datetime('now',?,?),datetime('now',?,?),?)`);

  [[14,1,'-6 hours'],[15,1,'-5 hours'],[9,1,'-7 hours'],
   [18,1,'-4 hours'],[19,2,'-5 hours'],[10,2,'-6 hours']
  ].forEach(([uid,lid,ci]) => insertClockOpen.run(uid,lid,ci));

  for (let day = 1; day <= 5; day++) {
    [[14,1,8],[15,1,8],[9,1,8],[18,1,7],[22,1,6],
     [19,2,8],[16,2,7],[10,2,8],[20,2,6]
    ].forEach(([uid,lid,hrs]) => {
      insertClock.run(uid, lid, `-${day} days`, '-8 hours', `-${day} days`, `-${8-hrs} hours`, hrs);
    });
  }

  // ── Schedules ────────────────────────────────────────────────────
  const insertSched = db.prepare(`INSERT INTO schedules (user_id, location_id, work_date, shift_start, shift_end, created_by) VALUES (?,?,date('now',?),?,?,?)`);
  const shifts = [['08:00','16:00'],['12:00','20:00'],['16:00','00:00']];
  [14,15,9,18,22,21].forEach((uid, i) => {
    for (let d = 0; d < 7; d++) {
      const s = shifts[(i + d) % shifts.length];
      insertSched.run(uid, 1, `+${d} days`, s[0], s[1], 2);
    }
  });

  function date(daysAhead) {
    const d = new Date(); d.setDate(d.getDate() + daysAhead);
    return d.toISOString().slice(0,10);
  }

  // ── Inventory (must be before supply orders) ─────────────────────
  const insertInv = db.prepare(`INSERT INTO inventory (location_id, item_name, category, unit, quantity, min_quantity) VALUES (?,?,?,?,?,?)`);
  const inventoryItems = [
    ['Beef Tenderloin', 'Meat',    'lbs',    100, 44], ['Chicken Breast', 'Meat',     'lbs',   132, 55],
    ['Atlantic Salmon', 'Seafood', 'lbs',     18, 33], ['Shrimp',         'Seafood',  'lbs',    66, 22],
    ['Roma Tomatoes',   'Produce', 'lbs',     88, 33], ['Mixed Greens',   'Produce',  'lbs',    11, 18],
    ['Potatoes',        'Produce', 'lbs',    176, 66], ['Garlic',         'Produce',  'lbs',    26, 11],
    ['Olive Oil',       'Pantry',  'gal',      5,  3], ['Sea Salt',       'Pantry',   'lbs',    44, 11],
    ['Black Pepper',    'Pantry',  'lbs',     18,  7], ['Flour',          'Pantry',   'lbs',   121, 44],
    ['Sugar',           'Pantry',  'lbs',     66, 22], ['Butter',         'Dairy',    'lbs',    55, 22],
    ['Heavy Cream',     'Dairy',   'qt',      13,  8], ['Parmesan',       'Dairy',    'lbs',    20, 11],
    ['Red Wine',        'Beverage','bottles', 40, 15], ['White Wine',     'Beverage', 'bottles',35, 15],
    ['Sparkling Water', 'Beverage','cases',   20,  8], ['Coffee Beans',   'Beverage', 'lbs',    33, 11],
  ];
  // Inventory IDs: loc1=1-20, loc2=21-40, loc3=41-60, loc4=61-80, loc5=81-100
  [1,2,3,4,5].forEach(locId => {
    inventoryItems.forEach(([name, cat, unit, qty, min]) => {
      const variance = (locId * 7 + name.length) % 20 - 10;
      insertInv.run(locId, name, cat, unit, Math.max(0, qty + variance), min);
    });
  });

  // Unit costs + SKUs (for valuation, COGS, and scan-to-receive demos)
  const costMap = { 'Beef Tenderloin':12,'Chicken Breast':4,'Atlantic Salmon':9,'Shrimp':8,'Roma Tomatoes':1.5,'Mixed Greens':2,'Potatoes':0.8,'Garlic':3,'Olive Oil':18,'Sea Salt':1,'Black Pepper':6,'Flour':0.6,'Sugar':0.7,'Butter':4.5,'Heavy Cream':3,'Parmesan':10,'Red Wine':12,'White Wine':11,'Sparkling Water':0.5,'Coffee Beans':9 };
  db.prepare(`SELECT id, item_name FROM inventory`).all().forEach(r => {
    db.prepare(`UPDATE inventory SET unit_cost=?, sku=? WHERE id=?`).run(costMap[r.item_name] || 1, 'SKU-' + String(r.id).padStart(4, '0'), r.id);
  });

  // ── Demo inventory lots with expiry (FIFO / expiring-soon panel) ──
  // For a few perishables at Downtown, split current stock into two dated lots:
  // one expiring very soon (or just expired) and one further out.
  const insLot = db.prepare(`INSERT INTO inventory_lots (item_id, location_id, lot_code, received_qty, quantity, unit_cost, expiry_date, received_by) VALUES (?,?,?,?,?,?,date('now', ?),?)`);
  const perishables = ['Atlantic Salmon','Shrimp','Mixed Greens','Heavy Cream','Roma Tomatoes'];
  perishables.forEach((name, i) => {
    const inv = db.prepare(`SELECT id, location_id, quantity, unit_cost FROM inventory WHERE item_name=? AND location_id=1`).get(name);
    if (!inv) return;
    const soon = Math.round(inv.quantity * 0.4 * 1000) / 1000;
    const later = Math.round((inv.quantity - soon) * 1000) / 1000;
    const soonOffset = (i - 1) + ' days';            // -1d (expired), 0d, +1d, +2d, +3d
    insLot.run(inv.id, inv.location_id, 'LOT-A' + (i + 1), soon, soon, inv.unit_cost || 0, soonOffset, null);
    insLot.run(inv.id, inv.location_id, 'LOT-B' + (i + 1), later, later, inv.unit_cost || 0, '+21 days', null);
  });

  // ── Vendors (master records) ─────────────────────────────────────
  const insertVendor = db.prepare(`INSERT INTO vendors (name, contact_name, phone, email, lead_time_days, notes) VALUES (?,?,?,?,?,?)`);
  [['Pacific Fresh Co.', 'Dana Lee', '(555) 410-0001', 'orders@pacificfresh.com', 2, 'Seafood & produce'],
   ['Green Valley Farms', 'Marco Ruiz', '(555) 410-0002', 'sales@greenvalley.com', 3, 'Organic greens'],
   ['Napa Valley Imports', 'Claire Dubois', '(555) 410-0003', 'wine@napaimports.com', 5, 'Wine & beverages'],
   ['Prime Meats LLC', 'Hank Boyd', '(555) 410-0004', 'hank@primemeats.com', 1, 'Beef, poultry']]
    .forEach(v => insertVendor.run(...v));

  // ── Supply Orders (item_ids from loc1 inventory: 1-20) ───────────
  const insertSO = db.prepare(`
    INSERT INTO supply_orders (item_id, item_name, location_id, quantity, status, ordered_by, vendor, shipping_address, tracking_number, expected_date, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now',?))
  `);
  // item 3=Atlantic Salmon(loc1), 6=Mixed Greens(loc1), 37=Red Wine(loc2), 48=Garlic(loc3), 4=Shrimp(loc1), 11=Black Pepper(loc1)
  insertSO.run(3,  'Atlantic Salmon', 1, 20, 'pending',  9, 'Pacific Fresh Co.',        '123 Harbor Blvd, Seattle WA', null,        date(3), '-1 days');
  insertSO.run(6,  'Mixed Greens',    1, 15, 'approved', 2, 'Green Valley Farms',       '456 Farm Rd, Salinas CA',     null,        date(5), '-2 days');
  insertSO.run(37, 'Red Wine',        2, 24, 'shipped',  3, 'Napa Valley Imports',      '789 Vine St, Napa CA',        'NVI-28341', date(2), '-3 days');
  insertSO.run(48, 'Garlic',          3, 10, 'received', 4, 'Sun Valley Produce',       '321 Orchard Ln, Fresno CA',   null,        null,    '-4 days');
  insertSO.run(4,  'Shrimp',          4, 25, 'pending',  5, 'Gulf Coast Seafood LLC',   '99 Marina Dr, Tampa FL',      null,        date(7), '-1 days');
  insertSO.run(91, 'Black Pepper',    5,  5, 'approved', 6, 'Spice World International','200 Trade Ave, Miami FL',     null,        date(4), '-2 days');

  // ── Transfer Requests ─────────────────────────────────────────────
  const insertTR = db.prepare(`
    INSERT INTO transfer_requests (item_name, quantity, from_location_id, to_location_id, requested_by, status, vendor, shipping_info, tracking_number, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now',?),datetime('now',?))
  `);
  insertTR.run('Beef Tenderloin', 10, 2, 1, 2,  'pending',    null,                    null,                        null,        'Needed for weekend banquet', '-1 days', '-1 days');
  insertTR.run('Heavy Cream',     5,  3, 1, 4,  'approved',   null,                    'Refrigerated van delivery', null,        'For pastry station',         '-2 days', '-1 days');
  insertTR.run('Olive Oil',       8,  4, 3, 5,  'in_transit', null,                    'Driver: John (555-9201)',   'TRK-8821',  'Urgent — stock critical',    '-3 days', '-1 days');
  insertTR.run('Coffee Beans',    3,  5, 2, 6,  'received',   'Artisan Roasters Inc.', 'Standard ground shipping',  'AR-44120',  null,                         '-5 days', '-2 days');
  insertTR.run('Parmesan',        4,  1, 5, 9,  'pending',    null,                    null,                        null,        'For new pasta menu items',   '-1 days', '-1 days');

  // ── Menu ────────────────────────────────────────────────────────
  const menuTemplate = [
    { name: 'Starters', sort: 0, items: [
      ['Caesar Salad', 'Crisp romaine, house dressing, croutons', 14, 0],
      ['Bruschetta',   'Tomato, basil, garlic on grilled bread',  12, 1],
      ['Calamari',     'Lightly fried, served with aioli',        16, 2],
      ['Soup du Jour', 'Chef\'s daily selection',                 10, 3],
    ]},
    { name: 'Mains', sort: 1, items: [
      ['Grilled Salmon',    'Atlantic salmon, lemon butter sauce', 32, 0],
      ['Beef Tenderloin',   '8oz filet, truffle jus',             45, 1],
      ['Chicken Marsala',   'Pan-seared, mushroom marsala sauce',  28, 2],
      ['Shrimp Scampi',     'Garlic butter, white wine, linguine', 30, 3],
      ['Mushroom Risotto',  'Arborio, wild mushrooms, parmesan',   22, 4],
      ['Pasta Carbonara',   'Guanciale, egg, pecorino',            24, 5],
    ]},
    { name: 'Desserts', sort: 2, items: [
      ['Chocolate Lava Cake', 'Warm, with vanilla ice cream',      12, 0],
      ['Tiramisu',            'Classic Italian, espresso soaked',  10, 1],
      ['Crème Brûlée',        'Vanilla custard, caramelized top',  11, 2],
      ['Cheesecake',          'New York style, berry compote',     10, 3],
    ]},
    { name: 'Beverages', sort: 3, items: [
      ['House Red Wine',   'Glass, chef\'s selection',   12, 0],
      ['House White Wine', 'Glass, chef\'s selection',   12, 1],
      ['Sparkling Water',  'San Pellegrino 500ml',        5, 2],
      ['Lemonade',         'Fresh squeezed, mint',        4, 3],
      ['Espresso',         'Double shot',                  6, 4],
      ['Cappuccino',       'Steamed milk, espresso',       7, 5],
    ]},
  ];

  // Central menu (template): location_id NULL. Locations link to it via central_id.
  const insertCentralCat  = db.prepare(`INSERT INTO menu_categories (location_id, name, sort_order) VALUES (NULL,?,?)`);
  const insertCentralItem = db.prepare(`INSERT INTO menu_items (category_id, location_id, name, description, price, sort_order) VALUES (?,NULL,?,?,?,?)`);
  const insertLocCat  = db.prepare(`INSERT INTO menu_categories (location_id, central_id, name, sort_order) VALUES (?,?,?,?)`);
  const insertLocItem = db.prepare(`INSERT INTO menu_items (category_id, location_id, central_id, name, description, price, sort_order) VALUES (?,?,?,?,?,?,?)`);

  const centralCatId = {}, centralItemId = {};
  menuTemplate.forEach(cat => {
    const cc = insertCentralCat.run(cat.name, cat.sort);
    centralCatId[cat.name] = cc.lastInsertRowid;
    cat.items.forEach(([name, desc, price, sort]) => {
      centralItemId[name] = insertCentralItem.run(cc.lastInsertRowid, name, desc, price, sort).lastInsertRowid;
    });
  });

  [1,2,3,4,5].forEach(locId => {
    menuTemplate.forEach(cat => {
      const catRow = insertLocCat.run(locId, centralCatId[cat.name], cat.name, cat.sort);
      cat.items.forEach(([name, desc, price, sort]) => {
        insertLocItem.run(catRow.lastInsertRowid, locId, centralItemId[name], name, desc, price, sort);
      });
    });
  });

  // ── Allergens & dietary tags on representative menu items ────────
  const dietMap = {
    'Caesar Salad':      ['gluten, dairy', 'vegetarian'],
    'Bruschetta':        ['gluten', 'vegetarian,vegan'],
    'Grilled Salmon':    ['fish', 'gluten_free'],
    'Mushroom Risotto':  ['dairy', 'vegetarian,gluten_free'],
    'Pasta Carbonara':   ['gluten, egg, dairy', ''],
    'Crème Brûlée':      ['dairy, egg', 'vegetarian,gluten_free'],
    'Lemonade':          ['', 'vegetarian,vegan,gluten_free'],
  };
  const setDiet = db.prepare(`UPDATE menu_items SET allergens=?, dietary=? WHERE name=?`);
  Object.entries(dietMap).forEach(([name, [allerg, diet]]) => setDiet.run(allerg || null, diet || null, name));

  // ── Recipes (bill of materials) — drive auto-depletion & auto-86 ──
  // Map menu item name -> [[inventory item name, qty per serving], ...]. Seeded
  // for every location by resolving ids by (location, name) so demos show stock
  // moving as orders are placed.
  const recipeTemplate = {
    'Caesar Salad':       [['Mixed Greens', 0.3], ['Parmesan', 0.05], ['Olive Oil', 0.02]],
    'Bruschetta':         [['Roma Tomatoes', 0.25], ['Garlic', 0.02], ['Olive Oil', 0.02]],
    'Calamari':           [['Olive Oil', 0.05], ['Flour', 0.1]],
    'Grilled Salmon':     [['Atlantic Salmon', 0.5], ['Butter', 0.05], ['Sea Salt', 0.01]],
    'Beef Tenderloin':    [['Beef Tenderloin', 0.5], ['Butter', 0.05], ['Black Pepper', 0.01]],
    'Chicken Marsala':    [['Chicken Breast', 0.5], ['Butter', 0.05], ['Red Wine', 0.1]],
    'Shrimp Scampi':      [['Shrimp', 0.4], ['Garlic', 0.03], ['White Wine', 0.1], ['Butter', 0.05]],
    'Mushroom Risotto':   [['Parmesan', 0.1], ['Butter', 0.05], ['Heavy Cream', 0.1]],
    'Pasta Carbonara':    [['Flour', 0.2], ['Parmesan', 0.08]],
    'Chocolate Lava Cake':[['Flour', 0.15], ['Sugar', 0.1], ['Butter', 0.08]],
    'Tiramisu':           [['Heavy Cream', 0.15], ['Sugar', 0.08], ['Coffee Beans', 0.03]],
    'Crème Brûlée':       [['Heavy Cream', 0.2], ['Sugar', 0.1]],
    'Cheesecake':         [['Heavy Cream', 0.15], ['Sugar', 0.1], ['Flour', 0.05]],
    'House Red Wine':     [['Red Wine', 0.2]],
    'House White Wine':   [['White Wine', 0.2]],
    'Sparkling Water':    [['Sparkling Water', 0.1]],
    'Espresso':           [['Coffee Beans', 0.02]],
    'Cappuccino':         [['Coffee Beans', 0.02], ['Heavy Cream', 0.05]],
  };
  const findMenuItem = db.prepare(`SELECT id FROM menu_items WHERE location_id=? AND name=?`);
  const findInvItem  = db.prepare(`SELECT id FROM inventory  WHERE location_id=? AND item_name=?`);
  const insertRecipe = db.prepare(`INSERT INTO recipes (menu_item_id, inventory_id, quantity) VALUES (?,?,?)`);
  [1,2,3,4,5].forEach(locId => {
    Object.entries(recipeTemplate).forEach(([itemName, ingredients]) => {
      const mi = findMenuItem.get(locId, itemName);
      if (!mi) return;
      ingredients.forEach(([invName, qty]) => {
        const inv = findInvItem.get(locId, invName);
        if (inv) insertRecipe.run(mi.id, inv.id, qty);
      });
    });
  });

  // ── Reservations ────────────────────────────────────────────────
  const insertRes = db.prepare(`
    INSERT INTO reservations (location_id, guest_name, guest_phone, party_size, reservation_date, reservation_time, status, notes, created_by)
    VALUES (?,?,?,?,date('now',?),?,?,?,?)
  `);
  // loc1=Downtown, loc2=Uptown, loc3=Airport — managed by managers 2,3,4
  const resData = [
    [1, 'James Wilson',    '(555) 201-1001', 4, '+0 days', '18:30', 'confirmed', 'Anniversary dinner',   2],
    [1, 'Maria Santos',    '(555) 201-1002', 2, '+0 days', '19:00', 'confirmed', null,                   2],
    [1, 'Robert Chen',     '(555) 201-1003', 6, '+0 days', '20:00', 'confirmed', 'Window table preferred',2],
    [1, 'Emily Larson',    '(555) 201-1004', 2, '+1 days', '19:30', 'confirmed', 'Vegetarian guests',    2],
    [2, 'Daniel Park',     '(555) 202-2001', 8, '+0 days', '18:00', 'confirmed', 'Birthday party',       3],
    [2, 'Sarah Mitchell',  '(555) 202-2002', 2, '+0 days', '20:30', 'pending',   null,                   3],
    [2, 'Tom Nguyen',      '(555) 202-2003', 4, '+1 days', '19:00', 'confirmed', null,                   3],
    [3, 'Linda Kowalski',  '(555) 203-3001', 3, '+0 days', '17:00', 'confirmed', 'Pre-flight dinner',    4],
    [1, 'Mark Davidson',   '(555) 201-1005', 2, '-1 days', '19:00', 'completed', null,                   2],
    [1, 'Alice Thompson',  '(555) 201-1006', 4, '-1 days', '20:00', 'no_show',   'Did not call',         2],
  ];
  resData.forEach(r => insertRes.run(...r));

  console.log('✅  Database seeded successfully!');
  console.log('');
  console.log('Demo login accounts:');
  console.log('  owner@restaurant.com   / owner123   (Owner)');
  console.log('  manager@downtown.com   / mgr123     (Manager — Downtown Bistro)');
  console.log('  chef@downtown.com      / chef123    (Chef)');
  console.log('  waiter@downtown.com    / wait123    (Waiter — Main Hall)');
  console.log('  waiter2@downtown.com   / wait123    (Waiter — Patio)');
  console.log('  desk@downtown.com      / desk123    (Front Desk)');
  console.log('  emp@downtown.com       / emp123     (Employee)');
  console.log('  stock@uptown.com       / stock123   (Stockroom)');
}

seed();
