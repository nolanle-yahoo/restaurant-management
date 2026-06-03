// Browser smoke for the customer feedback widget. We create a real order + reservation
// via the public API, then drive the actual post-service views (orderPlacedView /
// showDone) the app uses, and submit the widget end-to-end (real POST /feedback).
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const chk = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); c ? pass++ : fail++; };

const j = (m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ s: r.status, d: await r.json().catch(() => ({})) }));

async function clickStarsAndSubmit(page, scope) {
  const stars = page.locator(`${scope} .fb-stars`);
  const box = await stars.boundingBox();
  await page.mouse.click(box.x + box.width * 0.95, box.y + box.height / 2); // 5 stars
  await page.fill(`${scope} .fb-comment`, 'Smoke test review');
  await page.click(`${scope} .fb-submit`);
  await page.waitForTimeout(700);
  return (await page.locator(scope).textContent()).includes('Thank you');
}

(async () => {
  // Seed a real order + reservation
  const locs = await j('GET', '/public/locations');
  const locId = locs.d[0].id;
  const menu = await j('GET', '/public/menu?location_id=' + locId);
  const items = (menu.d.menu || []).flatMap(c => c.items || []).filter(x => !(x.modifier_groups && x.modifier_groups.length));
  const item = items.find(x => x.price > 0) || items[0];
  const ord = await j('POST', '/public/order', { location_id: locId, order_type: 'pickup', customer_name: 'Smoke', customer_phone: '5551112222', items: [{ id: item.id, quantity: 1 }] });
  const track = ord.d.tracking_code;
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const resv = await j('POST', '/public/reservations', { location_id: locId, guest_name: 'Smoke', guest_phone: '5553334444', party_size: 2, reservation_date: day, reservation_time: '18:30' });
  const rc = resv.d.confirmation_code;
  chk('seeded order + reservation', !!track && !!rc);

  const browser = await chromium.launch();

  // ── Order placed view ──
  const p1 = await (await browser.newContext()).newPage();
  await p1.goto(BASE + '/order.html');
  await p1.waitForLoadState('networkidle');
  await p1.evaluate(c => orderPlacedView({ tracking_code: c, paidLine: 'Paid: <b>$10</b>' }), track);
  await p1.waitForTimeout(300);
  chk('order: feedback widget rendered', await p1.locator('#orderFb .fb-stars').count() > 0);
  chk('order: feedback submitted (thank-you)', await clickStarsAndSubmit(p1, '#orderFb'));

  // ── Reservation done view (drive the real form so lastResCode is set naturally) ──
  const p2 = await (await browser.newContext()).newPage();
  await p2.goto(BASE + '/reserve.html');
  await p2.waitForLoadState('networkidle');
  await p2.waitForTimeout(500);
  await p2.fill('#rName', 'Smoke Resv');
  await p2.fill('#rPhone', '5553334444');
  await p2.fill('#rParty', '2');
  await p2.fill('#rDate', day);
  await p2.fill('#rTime', '18:30');
  await p2.click('button:has-text("Request Reservation")');
  await p2.waitForSelector('#resDone:not(.hidden)', { timeout: 8000 }).catch(() => {});
  await p2.waitForTimeout(400);
  chk('reservation: feedback widget rendered', await p2.locator('#resFb .fb-stars').count() > 0);
  chk('reservation: feedback submitted (thank-you)', await clickStarsAndSubmit(p2, '#resFb'));

  await browser.close();

  // Confirm both landed server-side with the right source + reference
  const login = await j('POST', '/auth/login', { email: 'owner@restaurant.com', password: 'owner123' });
  const fb = await fetch(BASE + '/api/feedback', { headers: { Authorization: 'Bearer ' + login.d.token } }).then(r => r.json());
  chk('server stored order review', fb.items.some(x => x.source === 'order' && x.reference_code === track));
  chk('server stored reservation review', fb.items.some(x => x.source === 'reservation' && x.reference_code === rc));

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
