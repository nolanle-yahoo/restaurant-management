function getUser() {
  try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
}

function requireAuth(allowedRoles) {
  const user = getUser();
  if (!user || !localStorage.getItem('token')) { location.href = '/'; return null; }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    redirectByRole(user.role);
    return null;
  }
  return user;
}

function redirectByRole(role, mobile) {
  if (mobile) {
    location.href = '/pages/mobile.html';
    return;
  }
  const map = {
    owner:     '/pages/owner.html',
    manager:   '/pages/manager.html',
    employee:  '/pages/employee.html',
    frontdesk: '/pages/frontdesk.html',
    waiter:    '/pages/waiter.html',
    chef:      '/pages/chef.html',
    stockroom: '/pages/manager.html',
  };
  location.href = map[role] || '/';
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  location.href = '/';
}

function populateSidebar(user) {
  const el = id => document.getElementById(id);
  if (el('sb-name'))     el('sb-name').textContent     = user.name;
  if (el('sb-role'))     el('sb-role').textContent     = user.role;
  if (el('sb-location')) el('sb-location').textContent = user.location_name || 'All Locations';
  const logoutBtn = document.querySelector('.logout-btn');
  if (logoutBtn) logoutBtn.onclick = logout;

  // Inject ⚙️ settings button above logout (once per page)
  const footer = document.querySelector('.sidebar-footer');
  if (footer && !footer.querySelector('.settings-link')) {
    const btn = document.createElement('button');
    btn.className = 'settings-link';
    btn.textContent = '⚙️ Account Settings';
    btn.onclick = openAccountSettings;
    Object.assign(btn.style, {
      width:'100%', padding:'8px', background:'none', border:'none',
      borderRadius:'8px', color:'rgba(255,255,255,.7)', fontSize:'12.5px',
      cursor:'pointer', textAlign:'left', marginBottom:'6px', transition:'background .15s',
    });
    btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,.08)';
    btn.onmouseleave = () => btn.style.background = 'none';
    footer.insertBefore(btn, logoutBtn);
  }

  if (!document.getElementById('accountSettingsModal')) _injectAccountSettingsModal();
  initClockWidget(user);
}

// ── Topbar clock in/out widget (all roles except owner) ──────
function initClockWidget(user) {
  if (!user || user.role === 'owner') return;
  if (document.getElementById('clockBtn')) return;   // employee page has its own full clock hero
  if (document.getElementById('clockWidget')) return; // already injected
  const right = document.querySelector('.topbar-right');
  if (!right) return;

  const wrap = document.createElement('div');
  wrap.id = 'clockWidget';
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px';
  right.insertBefore(wrap, right.firstChild);

  async function render() {
    let clockedIn = false;
    try { const s = await API.clockStatus(); clockedIn = s.clocked_in; } catch { return; }
    wrap.innerHTML = clockedIn
      ? `<span class="text-sm" style="color:var(--success);font-weight:700;white-space:nowrap">● On duty</span>
         <button class="btn btn-sm btn-danger" id="clockToggle">Clock Out</button>`
      : `<span class="text-sm text-muted" style="white-space:nowrap">○ Off duty</span>
         <button class="btn btn-sm btn-success" id="clockToggle">Clock In</button>`;
    document.getElementById('clockToggle').onclick = async () => {
      try {
        if (clockedIn) await API.clockOut(); else await API.clockIn();
        render();
      } catch(e) { alert(e.message); }
    };
  }
  render();
}

function _injectAccountSettingsModal() {
  const div = document.createElement('div');
  div.innerHTML = `
  <div class="modal-overlay" id="accountSettingsModal">
    <div class="modal" style="width:420px">
      <div class="modal-title">⚙️ Account Settings</div>
      <div class="tabs" id="settingsTabs" style="margin-bottom:18px">
        <button class="tab-btn active" data-tab="tabProfile">Profile</button>
        <button class="tab-btn" data-tab="tabPassword">Change Password</button>
      </div>
      <div id="tabProfile" class="tab-pane active">
        <div id="profileAlert" class="alert hidden"></div>
        <div class="form-group"><label>Name</label><input id="settingsName" placeholder="Your name"></div>
        <div class="form-group"><label>Email</label><input id="settingsEmail" type="email" placeholder="your@email.com"></div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button class="btn btn-primary" onclick="saveProfile()">Save Changes</button>
          <button class="btn btn-ghost" onclick="hideModal('accountSettingsModal')">Cancel</button>
        </div>
      </div>
      <div id="tabPassword" class="tab-pane">
        <div id="pwAlert" class="alert hidden"></div>
        <div class="form-group"><label>Current Password</label><input id="currentPw" type="password" placeholder="••••••••"></div>
        <div class="form-group"><label>New Password</label><input id="newPw" type="password" placeholder="Min 6 characters"></div>
        <div class="form-group"><label>Confirm New Password</label><input id="confirmPw" type="password" placeholder="Repeat new password"></div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button class="btn btn-primary" onclick="savePassword()">Update Password</button>
          <button class="btn btn-ghost" onclick="hideModal('accountSettingsModal')">Cancel</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(div.firstElementChild);
  initTabs('#settingsTabs');
  onModalOverlayClick('accountSettingsModal');
}

function openAccountSettings() {
  const user = getUser();
  document.getElementById('settingsName').value  = user?.name  || '';
  document.getElementById('settingsEmail').value = user?.email || '';
  document.getElementById('profileAlert').classList.add('hidden');
  document.getElementById('pwAlert').classList.add('hidden');
  document.getElementById('currentPw').value = '';
  document.getElementById('newPw').value = '';
  document.getElementById('confirmPw').value = '';
  showModal('accountSettingsModal');
}

async function saveProfile() {
  const name  = document.getElementById('settingsName').value.trim();
  const email = document.getElementById('settingsEmail').value.trim();
  if (!name || !email) return showAlert('profileAlert', 'Name and email are required');
  try {
    const { user } = await API.updateProfile({ name, email });
    localStorage.setItem('user', JSON.stringify(user));
    const el = document.getElementById('sb-name');
    if (el) el.textContent = user.name;
    showAlert('profileAlert', 'Profile updated!', 'success');
  } catch(e) { showAlert('profileAlert', e.message); }
}

async function savePassword() {
  const current  = document.getElementById('currentPw').value;
  const newPw    = document.getElementById('newPw').value;
  const confirm  = document.getElementById('confirmPw').value;
  if (!current || !newPw) return showAlert('pwAlert', 'All fields required');
  if (newPw !== confirm)  return showAlert('pwAlert', 'New passwords do not match');
  if (newPw.length < 6)   return showAlert('pwAlert', 'Password must be at least 6 characters');
  try {
    const r = await API.changePassword({ current_password: current, new_password: newPw });
    // Server rotated the session; keep this device signed in with the fresh token.
    if (r && r.token) localStorage.setItem('token', r.token);
    showAlert('pwAlert', 'Password changed. Other devices have been signed out.', 'success');
    document.getElementById('currentPw').value = '';
    document.getElementById('newPw').value = '';
    document.getElementById('confirmPw').value = '';
  } catch(e) { showAlert('pwAlert', e.message); }
}

async function logoutEverywhere() {
  if (!confirm('Sign out of all other devices? This session will stay signed in.')) return;
  try {
    const r = await API.logoutAll();
    if (r && r.token) localStorage.setItem('token', r.token);
    showAlert('pwAlert', r.message || 'All other sessions have been signed out.', 'success');
  } catch(e) { showAlert('pwAlert', e.message); }
}

function fmtTime(dt) {
  if (!dt) return '—';
  return new Date(dt + (dt.includes('T') ? '' : 'Z')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(dt) {
  if (!dt) return '—';
  return new Date(dt + (dt.includes('T') ? '' : 'Z')).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtDateTime(dt) {
  if (!dt) return '—';
  return fmtDate(dt) + ' ' + fmtTime(dt);
}
function timeAgo(dt) {
  if (!dt) return '';
  const diff = Math.floor((Date.now() - new Date(dt + (dt.includes('T') ? '' : 'Z'))) / 60000);
  if (diff < 1)  return 'just now';
  if (diff < 60) return `${diff}m ago`;
  return `${Math.floor(diff/60)}h ${diff%60}m ago`;
}
function elapsed(dt) {
  if (!dt) return '0m';
  const m = Math.floor((Date.now() - new Date(dt + (dt.includes('T') ? '' : 'Z'))) / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m/60)}h ${m%60}m`;
}

// All table statuses with display info
const TABLE_STATUSES = [
  { value: 'empty',           label: 'Empty',           emoji: '🪑', bg: '#fff',                    border: '#D1C9BB', text: '#999' },
  { value: 'occupied',        label: 'Occupied',         emoji: '👥', bg: 'rgba(76,134,201,.13)',     border: '#4C86C9', text: '#2E6DB0' },
  { value: 'waiting_order',   label: 'Ready to Order',  emoji: '📋', bg: 'rgba(201,168,76,.13)',     border: '#C9A84C', text: '#8B6B1F' },
  { value: 'ordered',         label: 'Ordered',          emoji: '✅', bg: 'rgba(196,118,42,.13)',     border: '#C4762A', text: '#8B4B0F' },
  { value: 'waiting_food',    label: 'Waiting Food',     emoji: '🍳', bg: 'rgba(230,126,34,.13)',     border: '#E67E22', text: '#9B5700' },
  { value: 'need_help',       label: 'Needs Help',       emoji: '🆘', bg: 'rgba(192,57,43,.15)',      border: '#C0392B', text: '#9B1C0E' },
  { value: 'waiting_payment', label: 'Waiting to Pay',  emoji: '💳', bg: 'rgba(155,89,182,.13)',     border: '#9B59B6', text: '#6C3483' },
  { value: 'special_request', label: 'Special Request',  emoji: '⭐', bg: 'rgba(26,188,156,.13)',     border: '#1ABC9C', text: '#148A72' },
  { value: 'ready_clean',     label: 'Ready to Clean',  emoji: '🧹', bg: 'rgba(74,124,89,.13)',      border: '#4A7C59', text: '#2D5E3A' },
  { value: 'cleaning',        label: 'Cleaning',         emoji: '🫧', bg: '#F5F5F5',                  border: '#999',    text: '#666' },
];

function tableStatusInfo(status) {
  return TABLE_STATUSES.find(s => s.value === status) || { label: status, emoji: '?', bg: '#fff', border: '#ccc', text: '#666' };
}
function tableStatusLabel(status) { return tableStatusInfo(status).label; }
function tableStatusEmoji(status) { return tableStatusInfo(status).emoji; }

function statusBadge(status) {
  const map = {
    pending:         ['badge-gold',    'Pending'],
    preparing:       ['badge-warning', 'Preparing'],
    ready:           ['badge-success', 'Ready'],
    served:          ['badge-muted',   'Served'],
    approved:        ['badge-success', 'Approved'],
    shipped:         ['badge-info',    'Shipped'],
    received:        ['badge-muted',   'Received'],
    active:          ['badge-success', 'Active'],
    inactive:        ['badge-muted',   'Inactive'],
    in_transit:      ['badge-warning', 'In Transit'],
    cancelled:       ['badge-danger',  'Cancelled'],
    denied:          ['badge-danger',  'Denied'],
    empty:           ['badge-muted',   'Empty'],
    occupied:        ['badge-info',    'Occupied'],
    waiting_order:   ['badge-gold',    'Ready to Order'],
    ordered:         ['badge-warning', 'Ordered'],
    waiting_food:    ['badge-warning', 'Waiting Food'],
    need_help:       ['badge-danger',  'Needs Help'],
    waiting_payment: ['badge-info',    'Waiting to Pay'],
    special_request: ['badge-success', 'Special Request'],
    ready_clean:     ['badge-success', 'Ready to Clean'],
    cleaning:        ['badge-muted',   'Cleaning'],
  };
  const [cls, label] = map[status] || ['badge-muted', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function initTabs(containerSel) {
  const container = document.querySelector(containerSel);
  if (!container) return;
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

function showModal(id) { document.getElementById(id).classList.add('open'); }
function hideModal(id) { document.getElementById(id).classList.remove('open'); }
function onModalOverlayClick(id) {
  // Delegated + null-safe: works even if the modal element is added later,
  // and never throws if the id is missing at call time.
  document.addEventListener('click', e => {
    if (e.target && e.target.id === id && e.target.classList && e.target.classList.contains('modal-overlay')) hideModal(id);
  });
}

function showAlert(elId, msg, type='danger') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function liveClock(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  tick();
  setInterval(tick, 1000);
}

function isMobile() {
  return window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

// ── Bill settlement / payment modal (shared) ─────────────────
let _payState = { orderId: null, onPaid: null, bill: null, tipPct: 0, stripe: null, card: null, cfg: null };

function _injectPaymentModal() {
  if (document.getElementById('paymentModal')) return;
  const div = document.createElement('div');
  div.innerHTML = `
  <div class="modal-overlay" id="paymentModal">
    <div class="modal" style="width:440px">
      <div class="modal-title" id="payTitle">Settle Bill</div>
      <div id="payAlert" class="alert hidden"></div>
      <div id="payBill" style="font-size:13.5px;margin-bottom:12px"></div>
      <div style="margin-bottom:10px">
        <label style="display:block;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">Tip</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px" id="tipBtns">
          <button class="btn btn-sm btn-ghost" onclick="setTip(0)">No tip</button>
          <button class="btn btn-sm btn-ghost" onclick="setTip(15)">15%</button>
          <button class="btn btn-sm btn-ghost" onclick="setTip(18)">18%</button>
          <button class="btn btn-sm btn-ghost" onclick="setTip(20)">20%</button>
        </div>
        <input type="number" id="payTip" min="0" step="0.01" value="0.00" oninput="_payState.tipPct=null;renderPayTotal()"
          style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px">
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">Payment Method</label>
        <div style="display:flex;gap:6px" id="payMethods">
          <button class="btn btn-sm btn-primary" data-m="card" onclick="setPayMethod('card')">💳 Card</button>
          <button class="btn btn-sm btn-ghost" data-m="cash" onclick="setPayMethod('cash')">💵 Cash</button>
          <button class="btn btn-sm btn-ghost" data-m="mobile" onclick="setPayMethod('mobile')">📱 Mobile</button>
        </div>
      </div>
      <div id="payCardWrap" style="display:none;margin-bottom:12px">
        <div id="payCardElement" style="padding:11px;border:1.5px solid var(--border);border-radius:8px"></div>
      </div>
      <div style="font-size:20px;font-weight:800;color:var(--burgundy);text-align:right;margin:8px 0 14px">
        Total: $<span id="payTotal">0.00</span>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-success" style="flex:1" id="payChargeBtn" onclick="submitPayment()">Charge</button>
        <button class="btn btn-ghost" onclick="hideModal('paymentModal')">Cancel</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(div.firstElementChild);
  onModalOverlayClick('paymentModal');
}

async function openPaymentModal(orderId, onPaid) {
  _injectPaymentModal();
  _payState = { orderId, onPaid, bill: null, tipPct: 0, method: 'card', stripe: null, card: null, cfg: null };
  document.getElementById('payAlert').classList.add('hidden');
  document.getElementById('payTip').value = '0.00';
  const pe = document.getElementById('payEmail'); if (pe) pe.value = '';
  setPayMethod('card');
  try {
    const [bill, cfg] = await Promise.all([API.bill(orderId), API.paymentConfig()]);
    _payState.bill = bill; _payState.cfg = cfg;
    if (bill.payment && bill.payment.status === 'paid') {
      document.getElementById('payBill').innerHTML = '<div class="alert alert-success">This order has already been paid.</div>';
    } else {
      document.getElementById('payTitle').textContent = `Settle Bill — Table ${bill.order.table_number}`;
      const lines = bill.items.map(i => `<div style="display:flex;justify-content:space-between;padding:3px 0"><span>${i.item_name} ×${i.quantity}</span><span>$${(i.price*i.quantity).toFixed(2)}</span></div>`).join('');
      document.getElementById('payBill').innerHTML = lines +
        `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;display:flex;justify-content:space-between"><span>Subtotal</span><span>$${bill.subtotal.toFixed(2)}</span></div>` +
        `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Tax (${Math.round(bill.tax_rate*100)}%)</span><span>$${bill.tax.toFixed(2)}</span></div>`;
    }
    renderPayTotal();
    showModal('paymentModal');
  } catch (e) { showAlert('payAlert', e.message); showModal('paymentModal'); }
}

function setTip(pct) {
  _payState.tipPct = pct;
  if (_payState.bill) document.getElementById('payTip').value = (_payState.bill.subtotal * pct / 100).toFixed(2);
  renderPayTotal();
}

function setPayMethod(m) {
  _payState.method = m;
  document.querySelectorAll('#payMethods [data-m]').forEach(b => b.className = 'btn btn-sm ' + (b.dataset.m === m ? 'btn-primary' : 'btn-ghost'));
  const stripeCard = m === 'card' && _payState.cfg && _payState.cfg.stripe_enabled && _payState.cfg.publishable_key;
  document.getElementById('payCardWrap').style.display = stripeCard ? 'block' : 'none';
  if (stripeCard) _mountStripeCard();
}

function renderPayTotal() {
  const b = _payState.bill; if (!b) return;
  const tip = parseFloat(document.getElementById('payTip').value) || 0;
  document.getElementById('payTotal').textContent = (b.subtotal + b.tax + Math.max(0, tip)).toFixed(2);
}

function _loadStripeJs() {
  return new Promise((resolve) => {
    if (window.Stripe) return resolve();
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/'; s.onload = resolve; s.onerror = resolve;
    document.head.appendChild(s);
  });
}

async function _mountStripeCard() {
  await _loadStripeJs();
  if (!window.Stripe || _payState.card) return;
  _payState.stripe = Stripe(_payState.cfg.publishable_key);
  const elements = _payState.stripe.elements();
  _payState.card = elements.create('card');
  _payState.card.mount('#payCardElement');
}

async function submitPayment() {
  const b = _payState.bill;
  if (!b || (b.payment && b.payment.status === 'paid')) return hideModal('paymentModal');
  const tip = Math.max(0, parseFloat(document.getElementById('payTip').value) || 0);
  const email = (document.getElementById('payEmail') || {}).value || '';
  const btn = document.getElementById('payChargeBtn');
  btn.disabled = true; btn.textContent = 'Processing…';
  try {
    const useStripe = _payState.method === 'card' && _payState.cfg && _payState.cfg.stripe_enabled && _payState.cfg.publishable_key;
    if (useStripe) {
      const intent = await API.paymentIntent({ order_id: _payState.orderId, tip, email });
      const result = await _payState.stripe.confirmCardPayment(intent.client_secret, { payment_method: { card: _payState.card } });
      if (result.error) throw new Error(result.error.message);
      await API.confirmPayment(intent.payment_id);
    } else {
      await API.recordPayment({ order_id: _payState.orderId, tip, method: _payState.method, email });
    }
    hideModal('paymentModal');
    showAlert('alertBox', 'Payment received — bill settled.', 'success');
    if (typeof _payState.onPaid === 'function') _payState.onPaid();
  } catch (e) {
    showAlert('payAlert', e.message || 'Payment failed');
  } finally {
    btn.disabled = false; btn.textContent = 'Charge';
  }
}

// ── WebSocket client ─────────────────────────────────────────
function connectWebSocket(locationId, handlers) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws, dead = false;

  function connect() {
    if (dead) return;
    try {
      ws = new WebSocket(`${proto}://${location.host}`);
      ws.onopen  = () => { if (locationId) ws.send(JSON.stringify({ type: 'auth', location_id: locationId })); };
      ws.onmessage = e => {
        try {
          const { event, data } = JSON.parse(e.data);
          if (handlers[event]) handlers[event](data);
        } catch {}
      };
      ws.onclose = () => { if (!dead) setTimeout(connect, 3000); };
      ws.onerror = () => {};
    } catch {}
  }

  connect();
  return { close() { dead = true; ws?.close(); } };
}

function toggleDark() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('darkMode', isDark ? 'on' : 'off');
  const btn = document.getElementById('darkToggle');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
}

function initDarkMode() {
  if (localStorage.getItem('darkMode') === 'on') document.body.classList.add('dark');
  const btn = document.getElementById('darkToggle');
  if (btn) btn.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
}

function initMobileSidebar() {
  const shell   = document.querySelector('.app-shell');
  const btn     = document.getElementById('hamburgerBtn');
  const overlay = document.getElementById('sidebarOverlay');
  if (!shell || !btn) return;
  btn.addEventListener('click', () => shell.classList.toggle('sidebar-open'));
  if (overlay) overlay.addEventListener('click', () => shell.classList.remove('sidebar-open'));
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) shell.classList.remove('sidebar-open');
    });
  });
}
document.addEventListener('DOMContentLoaded', () => { initDarkMode(); initMobileSidebar(); });
