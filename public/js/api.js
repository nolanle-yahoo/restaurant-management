const API = {
  base: '/api',

  _headers() {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  },

  async _req(method, path, body) {
    const res = await fetch(this.base + path, {
      method,
      headers: this._headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      location.href = '/';
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  },

  get(path)          { return this._req('GET',    path); },
  post(path, body)   { return this._req('POST',   path, body); },
  put(path, body)    { return this._req('PUT',    path, body); },
  delete(path)       { return this._req('DELETE', path); },

  login(email, password) { return this._req('POST', '/auth/login', { email, password }); },
  me()                   { return this._req('GET',  '/auth/me'); },

  employees(locId)   { return this.get('/employees' + (locId ? `?location_id=${locId}` : '')); },
  onDuty(locId)      { return this.get('/employees/on-duty' + (locId ? `?location_id=${locId}` : '')); },
  updateEmployee(id, data) { return this.put(`/employees/${id}`, data); },

  clockIn()          { return this.post('/clock/in'); },
  clockOut()         { return this.post('/clock/out'); },
  clockStatus()      { return this.get('/clock/status'); },
  clockHours(userId, week) { return this.get(`/clock/hours?user_id=${userId}&week=${week || 0}`); },
  clockRecent()      { return this.get('/clock/recent'); },

  tables(locId)      { return this.get('/tables?location_id=' + locId); },
  updateTable(id, status) { return this.put(`/tables/${id}`, { status }); },

  orders(locId, status) {
    let qs = locId ? `?location_id=${locId}` : '?';
    if (status) qs += (locId ? '&' : '') + `status=${status}`;
    return this.get('/orders' + qs);
  },
  createOrder(data)  { return this.post('/orders', data); },
  updateOrder(id, status) { return this.put(`/orders/${id}`, { status }); },

  inventory(locId)   { return this.get('/inventory' + (locId ? `?location_id=${locId}` : '')); },
  orderSupply(data)  { return this.post('/inventory/order', data); },
  updateSupplyOrder(id, status) { return this.put(`/inventory/order/${id}`, { status }); },
  transfer(data)     { return this.post('/inventory/transfer', data); },
  transactions(locId){ return this.get('/inventory/transactions' + (locId ? `?location_id=${locId}` : '')); },
  supplyOrders(locId){ return this.get('/inventory/supply-orders' + (locId ? `?location_id=${locId}` : '')); },

  locations()        { return this.get('/locations'); },
  locationsSummary() { return this.get('/locations/summary'); },
};
