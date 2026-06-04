// Browser smoke for the Day Close widget (owner Sales Analytics): Z-report renders for a
// chosen location, and a cash drawer can be opened and closed (over/short) via the UI.
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const chk = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? pass++ : fail++; };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();

  await page.goto(BASE + '/staff');
  await page.fill('#email', 'owner@restaurant.com');
  await page.fill('#password', 'owner123');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');

  // Go to Sales Analytics
  await page.click('text=Sales Analytics');
  await page.waitForTimeout(1000);
  chk('Day Close widget mounted', await page.locator('#ownerDayClose #zrBody').count() > 0);

  // Pick a single location → Z-report should populate
  await page.selectOption('#anLocFilter', '1');
  await page.waitForTimeout(1000);
  const zrText = await page.locator('#zrBody').textContent();
  chk('Z-report renders Net sales for the location', /Net sales/.test(zrText));

  // Cash drawer: open one if not already open (close any existing first via UI is complex; assume closed in fresh state)
  const hasFloat = await page.locator('#cashFloat').count();
  if (hasFloat) {
    await page.fill('#cashFloat', '300');
    await page.click('button:has-text("Open Drawer")');
    await page.waitForTimeout(900);
  }
  const cashText = await page.locator('#cashBody').textContent();
  chk('drawer open shows Expected in drawer', /Expected in drawer/.test(cashText));

  // Close the drawer via the prompt dialogs (count, then deposit)
  let promptCount = 0;
  page.on('dialog', async d => {
    promptCount++;
    // first prompt = counted cash, second = deposit
    await d.accept(promptCount === 1 ? '305' : '100');
  });
  await page.click('button:has-text("Count & Close")');
  await page.waitForTimeout(1200);
  const alertText = await page.locator('#cashAlert').textContent();
  chk('close shows over/short result', /Drawer closed/.test(alertText) && /(OVER|SHORT|balanced)/.test(alertText));
  chk('closed drawer appears in history', (await page.locator('#cashHistory table').count()) > 0);

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
