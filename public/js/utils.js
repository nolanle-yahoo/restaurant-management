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
        if (clockedIn) {
          const r = await API.clockOut();
          const h = r && r.handoff;
          if (h && h.reassigned)        alert(`Clocked out. Your ${h.orders} open order(s) were handed to ${h.to}.`);
          else if (h && h.notifiedOwner) alert(`Clocked out. No other staff are on duty, so the owner was notified to arrange coverage for your ${h.orders} open order(s).`);
        } else {
          await API.clockIn();
        }
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
    <div class="modal" id="accountSettingsBox">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;gap:10px">
        <div class="modal-title" style="margin:0">⚙️ Account Settings</div>
        <button id="settingsExpandBtn" title="Expand / shrink (drag the bottom-right corner to resize)" onclick="toggleAccountSettingsSize()">⤢</button>
      </div>
      <div class="tabs" id="settingsTabs" style="margin-bottom:18px;flex-wrap:wrap">
        <button class="tab-btn active" data-tab="tabProfile">Profile</button>
        <button class="tab-btn" data-tab="tabPassword">Change Password</button>
        <button class="tab-btn" data-tab="tabPay">My Pay</button>
        <button class="tab-btn" data-tab="tabSchedule">My Schedule</button>
        <button class="tab-btn" data-tab="tabMessage">Message</button>
        <button class="tab-btn" data-tab="tabTimeOff">Time Off</button>
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
      <div id="tabPay" class="tab-pane">
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">Your hours, pay, and tips for the last 7 days.</div>
        <div id="myPayInfo" style="font-size:14px">Loading…</div>
      </div>
      <div id="tabSchedule" class="tab-pane">
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">Your upcoming shifts.</div>
        <div id="myScheduleInfo" style="font-size:14px">Loading…</div>
      </div>
      <div id="tabMessage" class="tab-pane">
        <div id="msgAlert" class="alert hidden"></div>
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">Send a comment or question to your manager or the owner.</div>
        <div class="form-group"><label>To</label>
          <select id="msgRecipient" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px">
            <option value="manager">My Manager</option>
            <option value="owner">Owner</option>
            <option value="both">Manager &amp; Owner</option>
          </select></div>
        <div class="form-group"><label>Subject</label><input id="msgSubject" placeholder="Subject"></div>
        <div class="form-group"><label>Message</label><textarea id="msgBody" rows="3" placeholder="Your message…" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;resize:vertical"></textarea></div>
        <button class="btn btn-primary" onclick="sendStaffMessage()">Send</button>
        <div style="font-size:12px;color:var(--muted);margin:16px 0 6px;font-weight:700">Your messages</div>
        <div id="myMessagesInfo" style="font-size:13px">Loading…</div>
      </div>
      <div id="tabTimeOff" class="tab-pane">
        <div id="toAlert" class="alert hidden"></div>
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">Request time off. Your manager or the owner reviews it.</div>
        <div class="form-group"><label>Type</label>
          <select id="toType" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px">
            <option value="vacation">Vacation</option>
            <option value="sick">Sick</option>
            <option value="personal">Personal</option>
            <option value="other">Other</option>
          </select></div>
        <div style="display:flex;gap:10px">
          <div class="form-group" style="flex:1"><label>Start</label><input id="toStart" type="date" style="width:100%"></div>
          <div class="form-group" style="flex:1"><label>End</label><input id="toEnd" type="date" style="width:100%"></div>
        </div>
        <div class="form-group"><label>Reason (optional)</label><input id="toReason" placeholder="e.g., family event"></div>
        <button class="btn btn-primary" onclick="submitStaffTimeOff()">Request</button>
        <div style="font-size:12px;color:var(--muted);margin:16px 0 6px;font-weight:700">Your requests</div>
        <div id="myTimeOffInfo" style="font-size:13px">Loading…</div>
      </div>
      <div id="tabPassword" class="tab-pane">
        <div id="pwAlert" class="alert hidden"></div>
        <div class="form-group"><label>Current Password</label><input id="currentPw" type="password" placeholder="••••••••"></div>
        <div class="form-group"><label>New Password</label><input id="newPw" type="password" placeholder="Min 8 characters"></div>
        <div class="form-group"><label>Confirm New Password</label><input id="confirmPw" type="password" placeholder="Repeat new password"></div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button class="btn btn-primary" onclick="savePassword()">Update Password</button>
          <button class="btn btn-ghost" onclick="hideModal('accountSettingsModal')">Cancel</button>
        </div>
        <div style="border-top:1px solid var(--border);margin-top:18px;padding-top:14px">
          <div style="font-size:12.5px;color:var(--muted);margin-bottom:8px">Signed in on another device or a shared computer? Revoke every other session.</div>
          <button class="btn btn-ghost" style="width:100%;color:var(--danger);border-color:var(--danger)" onclick="logoutEverywhere()">🔒 Log Out Everywhere Else</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(div.firstElementChild);
  initTabs('#settingsTabs');
  onModalOverlayClick('accountSettingsModal');
}

function toggleAccountSettingsSize() {
  const box = document.getElementById('accountSettingsBox');
  if (!box) return;
  box.classList.toggle('expanded');
  // Clear any manual drag-resize so the expanded/normal preset applies cleanly.
  box.style.width = ''; box.style.height = '';
  const btn = document.getElementById('settingsExpandBtn');
  if (btn) btn.textContent = box.classList.contains('expanded') ? '⤡' : '⤢';
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
  loadMyPay();
  loadMySchedule();
  loadMyMessages();
  loadMyTimeOff();
}

async function sendStaffMessage() {
  const recipient_type = document.getElementById('msgRecipient').value;
  const subject = document.getElementById('msgSubject').value.trim();
  const message = document.getElementById('msgBody').value.trim();
  if (!subject || !message) return showAlert('msgAlert', 'Subject and message are required.');
  try {
    await API.messagesSend({ recipient_type, subject, message });
    document.getElementById('msgSubject').value = '';
    document.getElementById('msgBody').value = '';
    showAlert('msgAlert', 'Message sent.', 'success');
    loadMyMessages();
  } catch (e) { showAlert('msgAlert', e.message); }
}

async function loadMyMessages() {
  const el = document.getElementById('myMessagesInfo'); if (!el) return;
  try {
    const rows = await API.messagesMine();
    el.innerHTML = rows.length ? rows.map(m => {
      const replies = (m.replies || []).map(r =>
        `<div style="margin:4px 0 0 12px;padding-left:8px;border-left:2px solid var(--border);color:var(--muted)"><b>${r.sender_name} (${r.sender_role})</b>: ${r.message}</div>`).join('');
      return `<div style="padding:7px 0;border-bottom:1px solid var(--border)">
        <div><b>${m.subject}</b> <span style="font-size:11px;color:var(--muted)">→ ${m.recipient_type}</span></div>
        <div style="color:var(--muted)">${m.message}</div>${replies}</div>`;
    }).join('') : '<p style="color:var(--muted)">No messages yet.</p>';
  } catch (e) { el.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`; }
}

async function submitStaffTimeOff() {
  const type = document.getElementById('toType').value;
  const start_date = document.getElementById('toStart').value;
  const end_date = document.getElementById('toEnd').value;
  const reason = document.getElementById('toReason').value.trim();
  if (!start_date || !end_date) return showAlert('toAlert', 'Start and end dates are required.');
  if (end_date < start_date) return showAlert('toAlert', 'End date cannot be before the start date.');
  try {
    await API.timeOffCreate({ type, start_date, end_date, reason });
    document.getElementById('toReason').value = '';
    showAlert('toAlert', 'Request submitted.', 'success');
    loadMyTimeOff();
  } catch (e) { showAlert('toAlert', e.message); }
}

async function loadMyTimeOff() {
  const el = document.getElementById('myTimeOffInfo'); if (!el) return;
  const colors = { pending:'var(--muted)', approved:'var(--success)', denied:'var(--danger)', cancelled:'var(--muted)' };
  try {
    const rows = await API.timeOffList();
    el.innerHTML = rows.length ? rows.map(t => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
        <span>${t.type} · ${t.start_date} → ${t.end_date}</span>
        <span style="display:flex;gap:8px;align-items:center">
          <b style="color:${colors[t.status]||'var(--muted)'}">${t.status}</b>
          ${t.status === 'pending' ? `<button class="btn btn-sm btn-ghost" onclick="cancelMyTimeOff(${t.id})">Cancel</button>` : ''}
        </span></div>`).join('') : '<p style="color:var(--muted)">No requests yet.</p>';
  } catch (e) { el.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`; }
}
async function cancelMyTimeOff(id) {
  if (!confirm('Cancel this time-off request?')) return;
  try { await API.timeOffUpdate(id, { status: 'cancelled' }); loadMyTimeOff(); }
  catch (e) { showToast(e.message, 'error'); }
}

async function loadMySchedule() {
  const el = document.getElementById('myScheduleInfo'); if (!el) return;
  const me = JSON.parse(localStorage.getItem('user') || '{}');
  el.textContent = 'Loading…';
  try {
    const [rows, swaps] = await Promise.all([API.mySchedule(), API.shiftSwaps().catch(() => [])]);
    const fmt = wd => new Date(wd + 'T00:00:00').toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' });
    const swapByShift = {};
    swaps.forEach(sw => { if (sw.status === 'open' || sw.status === 'accepted') swapByShift[sw.shift_id] = sw; });

    const shiftsHtml = rows.length ? rows.map(s => {
      const sw = swapByShift[s.id];
      let action = `<button class="btn btn-sm" onclick="offerSwap(${s.id})">Offer swap</button>`;
      if (sw) action = sw.status === 'accepted'
        ? `<span style="font-size:12px;color:var(--muted)">Swap pending approval</span> <button class="btn btn-sm" onclick="cancelSwap(${sw.id})">Cancel</button>`
        : `<span style="font-size:12px;color:var(--gold,#b8860b)">Offered</span> <button class="btn btn-sm" onclick="cancelSwap(${sw.id})">Cancel</button>`;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span>${fmt(s.work_date)} <span class="fw-700">${s.shift_start}–${s.shift_end}</span></span>
        <span>${action}</span></div>`;
    }).join('') : '<p style="color:var(--muted);padding:8px 0">No upcoming shifts scheduled.</p>';

    // Open offers from colleagues that the caller can pick up.
    const claimable = swaps.filter(sw => sw.status === 'open' && sw.requester_id !== me.id);
    const claimHtml = claimable.length ? claimable.map(sw =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span>${sw.requester_name} · ${fmt(sw.work_date)} <span class="fw-700">${sw.shift_start}–${sw.shift_end}</span></span>
        <button class="btn btn-gold btn-sm" onclick="acceptSwap(${sw.id})">Take it</button></div>`
    ).join('') : '<p style="color:var(--muted);padding:8px 0">No open shifts to pick up.</p>';

    el.innerHTML =
      shiftsHtml +
      `<div style="font-size:12.5px;color:var(--muted);margin:14px 0 4px;font-weight:700">Open shifts you can take</div>` +
      claimHtml;
  } catch(e) { el.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`; }
}

async function offerSwap(shiftId) {
  if (!confirm('Offer this shift to colleagues at your location? A manager must approve once someone takes it.')) return;
  try { await API.shiftSwapCreate({ shift_id: shiftId }); showToast('Shift offered for swap'); loadMySchedule(); }
  catch(e) { showToast(e.message, 'error'); }
}
async function acceptSwap(id) {
  if (!confirm('Take this shift? Your manager will approve the swap.')) return;
  try { await API.shiftSwapAccept(id); showToast('Shift claimed — pending approval'); loadMySchedule(); }
  catch(e) { showToast(e.message, 'error'); }
}
async function cancelSwap(id) {
  if (!confirm('Cancel this swap?')) return;
  try { await API.shiftSwapCancel(id); showToast('Swap cancelled'); loadMySchedule(); }
  catch(e) { showToast(e.message, 'error'); }
}

async function loadMyPay() {
  const el = document.getElementById('myPayInfo'); if (!el) return;
  el.textContent = 'Loading…';
  try {
    const p = await API.myPay();
    const m = n => '$' + (Number(n)||0).toFixed(2);
    const row = (label, val) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span>${label}</span><span class="fw-700">${val}</span></div>`;
    el.innerHTML =
      row('Hours worked', (p.total_hours||0) + ' hrs') +
      row('Hourly rate', m(p.hourly_rate)) +
      row('Gross pay', m(p.gross_pay)) +
      row('Net pay (after 15%)', m(p.net_pay)) +
      row('Tips', m(p.tips)) +
      `<div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:800;color:var(--burgundy)"><span>Take-home</span><span>${m(p.take_home)}</span></div>` +
      `<div style="font-size:11.5px;color:var(--muted)">${p.start} → ${p.end}</div>`;
  } catch(e) { el.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`; }
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
  if (newPw.length < 8)   return showAlert('pwAlert', 'Password must be at least 8 characters');
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
      <div id="paySplit" style="display:none;margin-bottom:12px;background:var(--cream);border-radius:8px;padding:10px 12px">
        <label style="display:block;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">Split / Partial Payment</label>
        <div id="paySplitBalance" style="font-size:12.5px;color:var(--muted);margin-bottom:6px"></div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span style="font-size:13px">Pay subtotal $</span>
          <input type="number" id="paySplitSub" min="0" step="0.01" oninput="renderPayTotal()"
            style="width:90px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:14px">
          <button class="btn btn-sm btn-ghost" type="button" onclick="splitWay(2)">½</button>
          <button class="btn btn-sm btn-ghost" type="button" onclick="splitWay(3)">⅓</button>
          <button class="btn btn-sm btn-ghost" type="button" onclick="splitWay(4)">¼</button>
          <button class="btn btn-sm btn-ghost" type="button" onclick="splitWay(1)">Full</button>
        </div>
      </div>
      <div id="payLoyalty" style="display:none;margin-bottom:12px;background:var(--cream);border-radius:8px;padding:10px 12px">
        <label style="display:block;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">Loyalty Points</label>
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:6px" id="payLoyaltyInfo"></div>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="number" id="payRedeem" min="0" step="1" value="0" oninput="renderPayTotal()"
            style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:14px">
          <button class="btn btn-sm btn-ghost" type="button" onclick="redeemMax()">Use max</button>
        </div>
        <div style="font-size:12px;color:var(--success);margin-top:5px" id="payDiscountLine"></div>
      </div>
      <div id="payDiscount" style="display:none;margin-bottom:12px;background:var(--cream);border-radius:8px;padding:10px 12px">
        <label style="display:block;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">Discount / Comp</label>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <span>$</span>
          <input type="number" id="payManualDiscount" min="0" step="0.01" value="0" oninput="renderPayTotal()"
            style="width:90px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:14px">
          <input id="payDiscountReason" placeholder="Reason (e.g. comp)" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px">
          <button class="btn btn-sm btn-ghost" type="button" onclick="compBill()">Comp 100%</button>
        </div>
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
    const alreadyPaid = bill.payment && bill.payment.status === 'paid';
    const chargeBtn = document.getElementById('payChargeBtn');
    // Tip, method, card, and total controls only apply to an unpaid order.
    // (payCardWrap visibility is owned by setPayMethod, so it's toggled there.)
    const inputIds = ['tipBtns', 'payTip', 'payMethods'];
    const totalRow = document.getElementById('payTotal').parentElement;
    document.getElementById('payTitle').textContent = `Settle Bill — Table ${bill.order.table_number}`;

    if (alreadyPaid) {
      document.getElementById('payBill').innerHTML = '<div class="alert alert-success">This order has already been paid.</div>';
      chargeBtn.disabled = true;
      chargeBtn.textContent = 'Paid ✓';
      inputIds.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
      document.getElementById('payCardWrap').style.display = 'none';
      document.getElementById('payLoyalty').style.display = 'none';
      document.getElementById('payDiscount').style.display = 'none';
      document.getElementById('paySplit').style.display = 'none';
      totalRow.style.display = 'none';
    } else {
      chargeBtn.disabled = false;
      chargeBtn.textContent = 'Charge';
      inputIds.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
      totalRow.style.display = '';
      _payState.pointValue = bill.point_value || 0.05;
      // Split / partial: remaining food subtotal still owed.
      _payState.fullSub = bill.subtotal;
      _payState.remainingSub = (bill.balance_subtotal != null) ? bill.balance_subtotal : bill.subtotal;
      document.getElementById('paySplitSub').value = _payState.remainingSub.toFixed(2);
      document.getElementById('paySplitBalance').textContent = (bill.covered_subtotal > 0)
        ? `Partially paid — $${bill.covered_subtotal.toFixed(2)} of $${bill.subtotal.toFixed(2)} subtotal collected. Balance $${_payState.remainingSub.toFixed(2)}.`
        : `Pay the full subtotal ($${bill.subtotal.toFixed(2)}) or a portion to split the bill.`;
      document.getElementById('paySplit').style.display = 'block';
      // Loyalty / discount eligibility (applied only on a single full payment).
      _payState.maxRedeem = bill.customer ? Math.min(bill.customer.points, Math.floor((bill.subtotal + (bill.service_charge||0) + bill.tax) / _payState.pointValue)) : 0;
      _payState.hasLoyalty = !!(bill.customer && bill.customer.points > 0);
      _payState.canDiscount = !!(cfg.caps && cfg.caps.can_discount);
      document.getElementById('payRedeem').value = 0;
      document.getElementById('payManualDiscount').value = 0;
      document.getElementById('payDiscountReason').value = '';
      if (_payState.hasLoyalty) document.getElementById('payLoyaltyInfo').textContent =
        `${bill.customer.name} has ${bill.customer.points} pts (worth $${(bill.customer.points * _payState.pointValue).toFixed(2)}). Up to ${_payState.maxRedeem} redeemable.`;
      setPayMethod(_payState.method);   // restores card-field visibility per Stripe config
      const lines = bill.items.map(i => `<div style="display:flex;justify-content:space-between;padding:3px 0"><span>${i.item_name} ×${i.quantity}</span><span>$${(i.price*i.quantity).toFixed(2)}</span></div>`).join('');
      const svc = (bill.service_charge || 0) > 0
        ? `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Service charge (${Math.round((bill.service_rate||0)*100)}%)</span><span>$${bill.service_charge.toFixed(2)}</span></div>`
        : '';
      document.getElementById('payBill').innerHTML = lines +
        `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;display:flex;justify-content:space-between"><span>Subtotal</span><span>$${bill.subtotal.toFixed(2)}</span></div>` +
        svc +
        `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Tax (${Math.round(bill.tax_rate*100)}%)</span><span>$${bill.tax.toFixed(2)}</span></div>`;
      renderPayTotal();
    }
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
  _payState.stripeCard = stripeCard;
  document.getElementById('payCardWrap').style.display = stripeCard ? 'block' : 'none';
  if (stripeCard) _mountStripeCard();
  renderPayTotal();   // recompute totals + section visibility
}

function redeemMax() {
  document.getElementById('payRedeem').value = _payState.maxRedeem || 0;
  renderPayTotal();
}

// Current redeemed points (clamped to the allowed maximum).
function _redeemPts() {
  const v = parseInt(document.getElementById('payRedeem').value) || 0;
  return Math.max(0, Math.min(v, _payState.maxRedeem || 0));
}

// Subtotal portion being paid now (clamped to the remaining balance).
function _splitSub() {
  const rem = _payState.remainingSub != null ? _payState.remainingSub : (_payState.bill ? _payState.bill.subtotal : 0);
  const v = parseFloat(document.getElementById('paySplitSub').value);
  if (!Number.isFinite(v) || v <= 0) return rem;
  return Math.min(Math.round(v * 100) / 100, rem);
}
function _isPartial() { return _splitSub() < (_payState.remainingSub || 0) - 0.005; }
function splitWay(n) {
  const rem = _payState.remainingSub || 0;
  document.getElementById('paySplitSub').value = (n <= 1 ? rem : Math.round((rem / n) * 100) / 100).toFixed(2);
  renderPayTotal();
}

function _manualDiscount(portionBill) {
  if (_isPartial()) return 0;
  const loyalty = Math.round(_redeemPts() * (_payState.pointValue || 0.05) * 100) / 100;
  const v = Math.max(0, parseFloat(document.getElementById('payManualDiscount').value) || 0);
  return Math.min(v, Math.max(0, Math.round((portionBill - loyalty) * 100) / 100));
}

function compBill() {
  const b = _payState.bill; if (!b) return;
  splitWay(1); // comp implies paying the full remaining bill
  const portionBill = b.subtotal + (b.service_charge || 0) + b.tax;
  const loyalty = Math.round(_redeemPts() * (_payState.pointValue || 0.05) * 100) / 100;
  document.getElementById('payManualDiscount').value = Math.max(0, Math.round((portionBill - loyalty) * 100) / 100).toFixed(2);
  if (!document.getElementById('payDiscountReason').value) document.getElementById('payDiscountReason').value = 'comp';
  renderPayTotal();
}

function renderPayTotal() {
  const b = _payState.bill; if (!b) return;
  const full = _payState.fullSub || b.subtotal;
  const portionSub = _splitSub();
  const prop = full > 0 ? portionSub / full : 1;
  const portionService = Math.round((b.service_charge || 0) * prop * 100) / 100;
  const portionTax = Math.round(b.tax * prop * 100) / 100;
  const partial = _isPartial();
  // Loyalty + manual discount only apply to a single full payment.
  if (document.getElementById('payLoyalty')) document.getElementById('payLoyalty').style.display = (!partial && _payState.hasLoyalty && !_payState.stripeCard) ? 'block' : 'none';
  if (document.getElementById('payDiscount')) document.getElementById('payDiscount').style.display = (!partial && _payState.canDiscount) ? 'block' : 'none';
  const tip = parseFloat(document.getElementById('payTip').value) || 0;
  const pts = partial ? 0 : _redeemPts();
  const discount = Math.round(pts * (_payState.pointValue || 0.05) * 100) / 100;
  const line = document.getElementById('payDiscountLine');
  if (line) line.textContent = discount > 0 ? `−$${discount.toFixed(2)} loyalty discount (${pts} pts)` : '';
  const manual = _manualDiscount(portionSub + portionService + portionTax);
  const total = portionSub + portionService + portionTax - discount - manual + Math.max(0, tip);
  document.getElementById('payTotal').textContent = Math.max(0, total).toFixed(2);
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
    const amount = _splitSub();
    const partial = _isPartial();
    const useStripe = _payState.method === 'card' && _payState.cfg && _payState.cfg.stripe_enabled && _payState.cfg.publishable_key;
    let res;
    if (useStripe) {
      const intent = await API.paymentIntent({ order_id: _payState.orderId, tip, email, amount });
      const result = await _payState.stripe.confirmCardPayment(intent.client_secret, { payment_method: { card: _payState.card } });
      if (result.error) throw new Error(result.error.message);
      res = await API.confirmPayment(intent.payment_id);
    } else {
      const portionBill = (() => { const b=_payState.bill, full=_payState.fullSub||b.subtotal, prop=full>0?amount/full:1; return amount + (b.service_charge||0)*prop + b.tax*prop; })();
      res = await API.recordPayment({ order_id: _payState.orderId, tip, method: _payState.method, email, amount,
        redeem_points: partial ? 0 : _redeemPts(),
        manual_discount: partial ? 0 : _manualDiscount(portionBill), discount_reason: (document.getElementById('payDiscountReason') || {}).value || '' });
    }
    hideModal('paymentModal');
    const settled = !res || res.fully_paid !== false;
    showAlert('alertBox', settled ? 'Payment received — bill settled.' : `Partial payment received — balance $${(res.balance_subtotal||0).toFixed(2)} remaining.`, 'success');
    if (typeof _payState.onPaid === 'function') _payState.onPaid();
  } catch (e) {
    showAlert('payAlert', e.message || 'Payment failed');
  } finally {
    btn.disabled = false; btn.textContent = 'Charge';
  }
}

// ── Staff capabilities (configurable permissions) ────────────
let _staffCaps = null;
async function getCaps() {
  if (_staffCaps) return _staffCaps;
  try { _staffCaps = (await API.paymentConfig()).caps || {}; } catch { _staffCaps = {}; }
  return _staffCaps;
}
async function voidOrderPrompt(id, onDone) {
  const reason = prompt('Void this order? Optionally enter a reason:');
  if (reason === null) return; // cancelled
  try {
    await API.voidOrder(id, reason || '');
    showToast('Order voided', 'info');
    if (typeof onDone === 'function') onDone();
  } catch (e) { alert(e.message); }
}

// ── Toast notifications ──────────────────────────────────────
const TOAST_STYLE = {
  order_ready:  { icon: '✅', bg: '#2E7D46' },
  help:         { icon: '🔔', bg: '#C4762A' },
  low_stock:    { icon: '⚠️', bg: '#B0472A' },
  online_order: { icon: '🛍️', bg: '#6B1A1A' },
  reservation:  { icon: '📅', bg: '#4C86C9' },
  announcement: { icon: '📣', bg: '#6B1A1A' },
  info:         { icon: 'ℹ️', bg: '#333' },
};
function showToast(message, kind = 'info') {
  let wrap = document.getElementById('toastWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toastWrap';
    wrap.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:340px';
    document.body.appendChild(wrap);
  }
  const s = TOAST_STYLE[kind] || TOAST_STYLE.info;
  const t = document.createElement('div');
  t.style.cssText = `background:${s.bg};color:#fff;padding:12px 14px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:13.5px;display:flex;gap:8px;align-items:flex-start;animation:slideIn .25s ease;cursor:pointer`;
  t.innerHTML = `<span style="font-size:16px;line-height:1">${s.icon}</span><span>${message}</span>`;
  t.onclick = () => t.remove();
  wrap.appendChild(t);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(message); } catch {}
  }
  setTimeout(() => t.remove(), 8000);
}
// Show a toast only if the current user's role is targeted (or no roles set).
function _maybeToast(data) {
  if (!data || !data.message) return;
  try {
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    if (data.roles && Array.isArray(data.roles) && !data.roles.includes(u.role)) return;
  } catch {}
  showToast(data.message, data.kind);
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
          if (event === 'notify') _maybeToast(data);   // built-in operational toasts
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
