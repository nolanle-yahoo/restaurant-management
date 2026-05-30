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
    await API.changePassword({ current_password: current, new_password: newPw });
    showAlert('pwAlert', 'Password changed!', 'success');
    document.getElementById('currentPw').value = '';
    document.getElementById('newPw').value = '';
    document.getElementById('confirmPw').value = '';
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
  document.getElementById(id).addEventListener('click', e => { if (e.target === e.currentTarget) hideModal(id); });
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
