// Browser smoke: customer feedback widget appears after placing an online order and
// after booking a reservation, and submits successfully.
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const chk = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? pass++ : fail++; };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();

  // ── Order flow ──
  await page.goto(BASE + '/order.html');
  await page.waitForLoadState('networkidle');
  // pick first location, add first available item
  await page.waitForTimeout(800);
  // Add the first "Add" button item
  const addBtn = page.locator('button:has-text("Add")').first();
  await addBtn.click();
  await page.waitForTimeout(300);
  // fill pickup contact fields if present
  for (const [sel, val] of [['#custName', 'Smoke Guest'], ['#custPhone', '5551112222']]) {
    if (await page.locator(sel).count()) await page.fill(sel, val);
  }
  // place order (pay-on-collection / place button)
  const placeBtn = page.locator('button:has-text("Place")').first();
  await placeBtn.click();
  await page.waitForTimeout(1500);
  chk('order placed view shows feedback widget', await page.locator('#orderFb .fb-stars').count() > 0);
  // submit a rating
  if (await page.locator('#orderFb .fb-stars').count()) {
    const stars = page.locator('#orderFb .fb-stars');
    const box = await stars.boundingBox();
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2); // ~5 stars
    await page.click('#orderFb .fb-submit');
    await page.waitForTimeout(800);
    chk('order feedback submitted (thank-you shown)', (await page.locator('#orderFb').textContent()).includes('Thank you'));
  } else { chk('order feedback submitted (thank-you shown)', false); }

  // ── Reservation flow ──
  const p2 = await (await browser.newContext()).newPage();
  await p2.goto(BASE + '/reserve.html');
  await p2.waitForLoadState('networkidle');
  await p2.waitForTimeout(500);
  await p2.fill('#rName', 'Smoke Resv');
  if (await p2.locator('#rPhone').count()) await p2.fill('#rPhone', '5553334444');
  // date defaults to today; set time + party
  if (await p2.locator('#rTime').count()) await p2.fill('#rTime', '18:30');
  await p2.click('button:has-text("Request")').catch(() => {});
  await p2.waitForTimeout(1500);
  const resvDoneVisible = await p2.locator('#resDone').isVisible().catch(() => false);
  chk('reservation done view visible', resvDoneVisible);
  chk('reservation feedback widget present', await p2.locator('#resFb .fb-stars').count() > 0);

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
