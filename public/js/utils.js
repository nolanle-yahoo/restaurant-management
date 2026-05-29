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

function redirectByRole(role) {
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

function statusBadge(status) {
  const map = {
    pending:       ['badge-gold',    'Pending'],
    preparing:     ['badge-warning', 'Preparing'],
    ready:         ['badge-success', 'Ready'],
    served:        ['badge-muted',   'Served'],
    approved:      ['badge-success', 'Approved'],
    shipped:       ['badge-info',    'Shipped'],
    received:      ['badge-muted',   'Received'],
    active:        ['badge-success', 'Active'],
    inactive:      ['badge-muted',   'Inactive'],
    empty:         ['badge-muted',   'Empty'],
    waiting_order: ['badge-gold',    'Waiting Order'],
    ordered:       ['badge-warning', 'Ordered'],
    waiting_food:  ['badge-warning', 'Waiting Food'],
    ready_clean:   ['badge-success', 'Ready to Clean'],
    cleaning:      ['badge-muted',   'Cleaning'],
  };
  const [cls, label] = map[status] || ['badge-muted', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function tableStatusLabel(status) {
  const map = {
    empty: 'Empty', waiting_order: 'Waiting Order', ordered: 'Ordered',
    waiting_food: 'Waiting Food', ready_clean: 'Ready to Clean', cleaning: 'Cleaning'
  };
  return map[status] || status;
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
