// Browser smoke for the bartender/bar-tabs dashboard: login routes to the bar page,
// clock in, open a tab, add a drink from the bar menu, then close & settle it.
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const chk = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? pass++ : fail++; };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();

  // Login as bartender → should route to the bar station
  await page.goto(BASE + '/staff');
  await page.fill('#email', 'bartender@downtown.com');
  await page.fill('#password', 'bar123');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  chk('routed to bartender page', page.url().includes('/pages/bartender.html'));
  chk('bar tabs UI present', await page.locator('#tabsList').count() > 0);

  // Clock in if the widget says off duty
  const clockBtn = page.locator('#clockToggle');
  if (await clockBtn.count() && /Clock In/.test(await clockBtn.textContent())) {
    await clockBtn.click(); await page.waitForTimeout(600);
  }

  // Open a tab
  const tabName = 'Smoke Tab ' + Date.now();
  await page.fill('#tabName', tabName);
  await page.check('#tabIdChecked');
  await page.click('button:has-text("Open Tab")');
  await page.waitForTimeout(800);
  const card = page.locator('.tab-card', { hasText: tabName }).first();
  await card.waitFor({ timeout: 6000 });
  chk('tab card created', await card.count() > 0);
  chk('ID-checked badge shows', (await card.locator('button:has-text("ID ✓")').count()) > 0);

  // Add a drink from the bar menu (tab auto-selected as newest)
  const addBtn = page.locator('#barMenu button:has-text("Add")').first();
  await addBtn.waitFor({ timeout: 6000 });
  await addBtn.click();
  await page.waitForTimeout(900);
  const cardAfter = page.locator('.tab-card', { hasText: tabName }).first();
  chk('drink added to tab (line item visible)', (await cardAfter.locator('.tab-line').count()) >= 1);

  // Close & settle → opens the shared payment modal; charge it
  await cardAfter.locator('button:has-text("Close")').click();
  await page.waitForTimeout(800);
  const charge = page.locator('#payChargeBtn');
  chk('settle modal opened', await charge.count() > 0);
  await charge.click();
  await page.waitForTimeout(1200);

  // Tab should drop off the open list
  await page.waitForTimeout(600);
  chk('settled tab removed from open list', (await page.locator('.tab-card', { hasText: tabName }).count()) === 0);

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
