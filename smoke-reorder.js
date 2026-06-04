// Browser smoke for the auto-reorder panel (owner Supply Orders): a below-par item shows
// as a suggestion building to par, and "Create Purchase Orders" turns it into a pending PO.
const { chromium } = require('playwright');
const db = require('./db/database');
const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const chk = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? pass++ : fail++; };

(async () => {
  // Ensure a below-par item exists at loc 1 (throwaway).
  const existing = db.prepare("SELECT id FROM inventory WHERE location_id=1 AND item_name='ZZ Test Reorder'").get();
  let itemId = existing && existing.id;
  if (!itemId) {
    itemId = db.prepare("INSERT INTO inventory (location_id,item_name,category,unit,quantity,min_quantity,unit_cost,par_level) VALUES (1,'ZZ Test Reorder','Pantry','units',2,20,3,50)").run().lastInsertRowid;
  } else {
    db.prepare('UPDATE inventory SET quantity=2,min_quantity=20,unit_cost=3,par_level=50 WHERE id=?').run(itemId);
  }

  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/staff');
  await page.fill('#email', 'owner@restaurant.com');
  await page.fill('#password', 'owner123');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');

  await page.click('text=Supply Orders');
  await page.waitForTimeout(800);
  chk('reorder panel mounted', await page.locator('#ownerReorder #roBody').count() > 0);

  await page.selectOption('#supplyLocFilter', '1');
  await page.waitForTimeout(1000);
  const row = page.locator('#roBody tr', { hasText: 'ZZ Test Reorder' }).first();
  await row.waitFor({ timeout: 6000 });
  chk('below-par item listed as a suggestion', await row.count() > 0);
  const qtyVal = await row.locator('.ro-qty').inputValue();
  chk('suggested qty builds to par (48 = 50-2)', qtyVal === '48');

  const before = db.prepare("SELECT COUNT(*) n FROM supply_orders WHERE item_id=? AND status='pending'").get(itemId).n;
  // Accept the confirm() dialog, then create POs
  page.on('dialog', d => d.accept());
  await page.click('#ownerReorder button:has-text("Create Purchase Orders")');
  await page.waitForTimeout(1200);
  const after = db.prepare("SELECT COUNT(*) n FROM supply_orders WHERE item_id=? AND status='pending'").get(itemId).n;
  chk('Create Purchase Orders created a pending PO', after === before + 1);
  const alertText = await page.locator('#roAlert').textContent();
  chk('success message shown', /Created \d+ purchase order/.test(alertText));

  await browser.close();
  // cleanup: remove throwaway item + its POs, and normalize the integration-test item
  db.prepare('DELETE FROM supply_orders WHERE item_id=?').run(itemId);
  db.prepare('DELETE FROM inventory WHERE id=?').run(itemId);
  // normalize the first loc-1 item the backend test had pushed below par
  db.prepare("UPDATE inventory SET quantity=min_quantity*2, par_level=NULL WHERE id=(SELECT id FROM inventory WHERE location_id=1 ORDER BY id LIMIT 1)").run();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
