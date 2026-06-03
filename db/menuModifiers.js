// Category-appropriate menu modifier groups (sides, add-ons, sizes…) applied to every
// real menu item at every location. Idempotent: skips any group already present on an
// item by name, so bespoke/seed groups and re-runs never duplicate. Shared by the seed
// (so a re-seed recreates them) and runnable standalone to backfill existing data.
const dbDefault = require('./database');

// key -> [groupName, min_select, max_select, [[optionName, priceDelta], ...]]
const TEMPLATES = {
  side:         ['Choose a side', 1, 1, [['Fries', 0], ['Garlic mashed', 0], ['House salad', 0], ['Seasonal veg', 0], ['Truffle fries', 3]]],
  mainAddons:   ['Add-ons', 0, 3, [['Extra Cheese', 1.5], ['Bacon', 2], ['Avocado', 1.5], ['Fried Egg', 1.5]]],
  protein:      ['Add a protein', 0, 1, [['Grilled Chicken', 6], ['Grilled Shrimp', 8], ['Seared Salmon', 9]]],
  extras:       ['Extras', 0, 3, [['Extra dressing', 0.5], ['Croutons', 0.5], ['Shaved Parmesan', 1]]],
  alaMode:      ['A la mode', 0, 1, [['Vanilla ice cream', 3], ['Whipped cream', 1.5]]],
  dessAddons:   ['Add-ons', 0, 2, [['Fresh berries', 2], ['Chocolate drizzle', 1], ['Caramel drizzle', 1]]],
  sizeStd:      ['Size', 1, 1, [['Regular', 0], ['Large', 1.5]]],
  wineSize:     ['Size', 1, 1, [['Glass', 0], ['Large pour', 4]]],
  waterSize:    ['Size', 1, 1, [['Small', 0], ['Large', 2]]],
  coffeeAddons: ['Add-ons', 0, 3, [['Extra shot', 1], ['Oat milk', 0.75], ['Vanilla syrup', 0.75]]],
  lemonAddons:  ['Add-ons', 0, 2, [['Fresh mint', 0.5], ['Extra lemon', 0]]],
};

// Sides only on entrées; add-ons broadly; sizes for drinks. Beverages vary, so a few are
// matched by name; everything else falls back to its category default.
const BY_CATEGORY = { Starters: ['protein', 'extras'], Mains: ['side', 'mainAddons'], Desserts: ['alaMode', 'dessAddons'] };
const BY_NAME = {
  'House Red Wine': ['wineSize'], 'House White Wine': ['wineSize'], 'Sparkling Water': ['waterSize'],
  'Lemonade': ['sizeStd', 'lemonAddons'], 'Espresso': ['coffeeAddons'], 'Cappuccino': ['sizeStd', 'coffeeAddons'],
};

function applyMenuModifiers(db = dbDefault) {
  const items = db.prepare(`SELECT mi.id, mi.name, c.name AS cat
                            FROM menu_items mi JOIN menu_categories c ON mi.category_id=c.id
                            WHERE mi.location_id IS NOT NULL`).all();
  const hasGroup = db.prepare(`SELECT id FROM modifier_groups WHERE menu_item_id=? AND name=?`);
  const maxSort  = db.prepare(`SELECT COALESCE(MAX(sort_order),-1) m FROM modifier_groups WHERE menu_item_id=?`);
  const insGroup = db.prepare(`INSERT INTO modifier_groups (menu_item_id, name, min_select, max_select, sort_order) VALUES (?,?,?,?,?)`);
  const insOpt   = db.prepare(`INSERT INTO modifier_options (group_id, name, price_delta, sort_order) VALUES (?,?,?,?)`);
  let added = 0;
  for (const it of items) {
    const keys = BY_NAME[it.name] || BY_CATEGORY[it.cat] || [];
    let sort = maxSort.get(it.id).m + 1;
    for (const k of keys) {
      const [name, min, max, opts] = TEMPLATES[k];
      if (hasGroup.get(it.id, name)) continue; // keep bespoke groups; never duplicate
      const gid = insGroup.run(it.id, name, min, max, sort++).lastInsertRowid;
      opts.forEach((o, i) => insOpt.run(gid, o[0], o[1], i));
      added++;
    }
  }
  return added;
}

module.exports = { applyMenuModifiers, TEMPLATES, BY_CATEGORY, BY_NAME };
