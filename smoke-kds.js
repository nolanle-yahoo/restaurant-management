// Browser smoke for KDS course-firing + prep timers. Seeds a multi-course dine-in
// order (Appetizers auto-fired, Mains/Desserts held), then in the chef page verifies a
// held course shows a Fire button, a fired course shows a live prep timer, and clicking
// Fire moves a held course onto the line.
const { chromium } = require('playwright');
const db = require('./db/database');
const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const chk = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? pass++ : fail++; };
const j = (m, p, b, t) => fetch(BASE + '/api' + p, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, t ? { Authorization: 'Bearer ' + t } : {}), body: b ? JSON.stringify(b) : undefined }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));

async function login(page, email, password) {
  await page.goto(BASE + '/staff');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

(async () => {
  // Seed a multi-course dine-in order on table 3 @ loc 1
  const w = await j('POST', '/auth/login', { email: 'waiter@downtown.com', password: 'wait123' });
  const tok = w.d.token;
  await j('POST', '/clock/in', {}, tok);
  const mi = await j('GET', '/menu/items?location_id=1', null, tok);
  const pick = c => mi.d.find(x => x.category_name === c && x.is_available);
  const s = pick('Starters'), m = pick('Mains'), d = pick('Desserts');
  const ord = await j('POST', '/orders', { table_id: 3, items: [
    { name: s.name, quantity: 1, price: s.price },
    { name: m.name, quantity: 1, price: m.price },
    { name: d.name, quantity: 1, price: d.price },
  ] }, tok);
  chk('seeded multi-course dine-in order', ord.s === 200);
  const oid = ord.d.order_id;

  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await login(page, 'chef@downtown.com', 'chef123');
  await page.waitForTimeout(1200); // let the queue render

  const card = page.locator('.order-card', { hasText: 'Table 3' }).first();
  await card.waitFor({ timeout: 8000 });
  chk('order card visible on KDS', await card.count() > 0);
  chk('a fired course shows a live prep timer', (await card.locator('.prep-chip').count()) >= 1);
  chk('held course shows a Fire button', (await card.locator('.fire-btn').count()) >= 1);
  const chipText = await card.locator('.prep-chip').first().textContent();
  chk('prep timer shows m:ss / target', /\d+:\d{2}\s*\/\s*\d+m/.test(chipText));

  const heldBefore = await card.locator('.fire-btn').count();
  // Fire the first held course (a per-course Fire button, not the "Fire all" footer one)
  await card.locator('button.fire-btn', { hasText: '🔥 Fire' }).first().click();
  await page.waitForTimeout(1500); // fire POST + queue reload
  const cardAfter = page.locator('.order-card', { hasText: 'Table 3' }).first();
  const chipsAfter = await cardAfter.locator('.prep-chip').count();
  chk('firing a course adds another running timer', chipsAfter >= 2);

  // Server reflects at least 2 fired courses now
  const after = (await j('GET', '/orders', null, tok)).d.find(o => o.id === oid);
  const firedCourses = new Set((after.items || []).filter(i => i.fired_at).map(i => i.course));
  chk('server shows >=2 fired courses', firedCourses.size >= 2);

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
