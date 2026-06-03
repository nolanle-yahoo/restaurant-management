// Browser smoke: owner Guest Feedback period filter + Audit Log period filter,
// and the manager "Activity & Reviews" tab (feedback + activity log).
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const chk = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; };

async function login(page, email, password) {
  await page.goto(BASE + '/staff');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // ── Owner ──
  await login(page, 'owner@restaurant.com', 'owner123');
  // Open Audit Log section via nav (find link by text)
  await page.click('text=Audit Log');
  await page.waitForTimeout(500);
  chk('owner audit period selector present', await page.locator('#auditPeriod').count() > 0);
  await page.selectOption('#auditPeriod', 'today');
  await page.waitForTimeout(400);
  chk('owner audit list rendered (today)', await page.locator('#auditList table, #auditList p').count() > 0);

  // Guest Feedback lives under Sales Analytics
  await page.click('text=Sales Analytics');
  await page.waitForTimeout(700);
  chk('owner feedback period selector present', await page.locator('#fbPeriod').count() > 0);
  chk('owner feedback avg badge shows reviews', /review|No reviews/.test(await page.locator('#fbAvg').textContent()));
  await page.selectOption('#fbPeriod', 'today');
  await page.waitForTimeout(500);
  chk('owner feedback list rendered', await page.locator('#ownerFeedback').textContent() !== '');

  // ── Manager ──
  const p2 = await (await browser.newContext()).newPage();
  await login(p2, 'manager@downtown.com', 'mgr123');
  await p2.click('text=Activity & Reviews');
  await p2.waitForTimeout(700);
  chk('mgr activity period selector present', await p2.locator('#actPeriod').count() > 0);
  chk('mgr feedback section rendered', (await p2.locator('#mgrFeedback').textContent()).length > 0);
  chk('mgr activity log rendered', (await p2.locator('#mgrActivityLog').textContent()).length > 0);
  chk('mgr feedback shows a review star', (await p2.locator('#mgrFeedback').textContent()).includes('★'));
  await p2.selectOption('#actPeriod', 'today');
  await p2.waitForTimeout(500);
  chk('mgr activity reloaded after period change', (await p2.locator('#mgrFeedback').textContent()).length > 0);

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
