// Browser smoke for the Live Labor board (owner Sales Analytics): seeds an on-duty
// staffer in overtime, then verifies the labor card renders summary stats, the OT alert,
// and the staff row with an OVERTIME badge.
const { chromium } = require('playwright');
const db = require('./db/database');
const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const chk = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? pass++ : fail++; };
const j = (m, p, b, t) => fetch(BASE + '/api' + p, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, t ? { Authorization: 'Bearer ' + t } : {}), body: b ? JSON.stringify(b) : undefined }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));

(async () => {
  const waiterId = db.prepare("SELECT id FROM users WHERE email='waiter@downtown.com'").get().id;
  const d = new Date();
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10) + ' 00:00:00';
  // Isolate week, clock in, and add a 42h synthetic shift → overtime.
  db.prepare('DELETE FROM clock_records WHERE user_id=? AND location_id=1 AND check_in>=?').run(waiterId, monday);
  const W = (await j('POST', '/auth/login', { email: 'waiter@downtown.com', password: 'wait123' })).d.token;
  await j('POST', '/clock/in', {}, W);
  db.prepare("INSERT INTO clock_records (user_id,location_id,check_in,check_out,hours_worked) VALUES (?,1,datetime('now','-3 hours'),datetime('now','-1 hours'),42)").run(waiterId);

  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/staff');
  await page.fill('#email', 'owner@restaurant.com');
  await page.fill('#password', 'owner123');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.click('text=Sales Analytics');
  await page.waitForTimeout(900);
  chk('Live Labor card mounted', await page.locator('#ownerLabor #laborBody').count() > 0);

  await page.selectOption('#anLocFilter', '1');
  await page.waitForTimeout(1000);
  const body = await page.locator('#laborBody').textContent();
  chk('shows Labor % stat', /Labor %/.test(body));
  chk('shows On duty stat', /On duty/.test(body));
  chk('OT alert banner present', /overtime/i.test(body) && /review the schedule/i.test(body));
  chk('on-duty staff row with OVERTIME badge', (await page.locator('#laborBody table').count()) > 0 && /OVERTIME/.test(body));

  await browser.close();
  // cleanup
  db.prepare('DELETE FROM clock_records WHERE user_id=? AND location_id=1 AND check_in>=?').run(waiterId, monday);
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
