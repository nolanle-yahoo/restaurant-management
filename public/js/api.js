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

  get(path)        { return this._req('GET',    path); },
  post(path, body) { return this._req('POST',   path, body); },
  put(path, body)  { return this._req('PUT',    path, body); },
  delete(path)     { return this._req('DELETE', path); },

  login(email, password) { return this._req('POST', '/auth/login', { email, password }); },
  me()                   { return this._req('GET',  '/auth/me'); },

  employees(locId)         { return this.get('/employees' + (locId ? `?location_id=${locId}` : '')); },
  allEmployees()           { return this.get('/employees/all'); },
  getEmployee(id)          { return this.get(`/employees/${id}`); },
  onDuty(locId)            { return this.get('/employees/on-duty' + (locId ? `?location_id=${locId}` : '')); },
  createEmployee(data)     { return this.post('/employees', data); },
  updateEmployee(id, data) { return this.put(`/employees/${id}`, data); },
  deleteEmployee(id)       { return this.delete(`/employees/${id}`); },

  timesheets(start, end, locId) {
    let qs = `?start=${start}&end=${end}`;
    if (locId) qs += `&location_id=${locId}`;
    return this.get('/timesheets' + qs);
  },

  clockIn()          { return this.post('/clock/in'); },
  clockOut()         { return this.post('/clock/out'); },
  clockStatus()      { return this.get('/clock/status'); },
  clockHours(userId, week) { return this.get(`/clock/hours?user_id=${userId}&week=${week || 0}`); },
  clockRecent()      { return this.get('/clock/recent'); },

  areas(locId)       { return this.get('/areas' + (locId ? `?location_id=${locId}` : '')); },
  areaAssignments(locId) { return this.get('/areas/assignments' + (locId ? `?location_id=${locId}` : '')); },
  assignWaiter(data) { return this.post('/areas/assignments', data); },
  removeAssignment(id) { return this.delete(`/areas/assignments/${id}`); },
  createArea(data)   { return this.post('/areas', data); },
  updateArea(id, data) { return this.put(`/areas/${id}`, data); },
  deleteArea(id)     { return this.delete(`/areas/${id}`); },

  tables(locId)      { return this.get('/tables?location_id=' + locId); },
  tablesByArea(locId){ return this.get('/tables/by-area?location_id=' + locId); },
  updateTable(id, status) { return this.put(`/tables/${id}`, { status }); },
  createTable(data)        { return this.post('/tables', data); },
  updateTableMeta(id, data){ return this.put(`/tables/${id}`, data); },
  deleteTable(id)          { return this.delete(`/tables/${id}`); },

  orders(locId, status) {
    let qs = locId ? `?location_id=${locId}` : '?';
    if (status) qs += (locId ? '&' : '') + `status=${status}`;
    return this.get('/orders' + qs);
  },
  createOrder(data)  { return this.post('/orders', data); },
  updateOrder(id, status) { return this.put(`/orders/${id}`, { status }); },

  inventory(locId)   { return this.get('/inventory' + (locId ? `?location_id=${locId}` : '')); },
  warehouse()        { return this.get('/inventory/warehouse'); },
  orderSupply(data)  { return this.post('/inventory/order', data); },
  updateSupplyOrder(id, data) { return this.put(`/inventory/order/${id}`, typeof data === 'string' ? { status: data } : data); },
  transfer(data)     { return this.post('/inventory/transfer', data); },
  transactions(locId){ return this.get('/inventory/transactions' + (locId ? `?location_id=${locId}` : '')); },
  supplyOrders(locId){ return this.get('/inventory/supply-orders' + (locId ? `?location_id=${locId}` : '')); },
  transferRequests(locId) { return this.get('/inventory/transfer-requests' + (locId ? `?location_id=${locId}` : '')); },
  createTransferRequest(data)    { return this.post('/inventory/transfer-request', data); },
  updateTransferRequest(id, data){ return this.put(`/inventory/transfer-request/${id}`, data); },

  locations()        { return this.get('/locations'); },
  locationsSummary() { return this.get('/locations/summary'); },

  timeOffList(locId)       { return this.get('/time-off' + (locId ? `?location_id=${locId}` : '')); },
  timeOffCreate(data)      { return this.post('/time-off', data); },
  timeOffUpdate(id, data)  { return this.put(`/time-off/${id}`, data); },

  messagesList(locId)      { return this.get('/messages' + (locId ? `?location_id=${locId}` : '')); },
  messagesMine()           { return this.get('/messages/mine'); },
  messagesSend(data)       { return this.post('/messages', data); },
  messagesRead(id)         { return this.put(`/messages/${id}/read`, {}); },
  messagesDelete(id)       { return this.delete(`/messages/${id}`); },

  reservations(params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v)).toString();
    return this.get('/reservations' + (qs ? '?' + qs : ''));
  },
  reservationCreate(data)     { return this.post('/reservations', data); },
  reservationUpdate(id, data) { return this.put(`/reservations/${id}`, data); },
  reservationDelete(id)       { return this.delete(`/reservations/${id}`); },

  menuCategories(locId)        { return this.get('/menu/categories' + (locId ? `?location_id=${locId}` : '')); },
  menuCategoryCreate(data)     { return this.post('/menu/categories', data); },
  menuCategoryUpdate(id, data) { return this.put(`/menu/categories/${id}`, data); },
  menuCategoryDelete(id)       { return this.delete(`/menu/categories/${id}`); },
  menuItems(locId, catId)      {
    let qs = locId ? `?location_id=${locId}` : '';
    if (catId) qs += (qs ? '&' : '?') + `category_id=${catId}`;
    return this.get('/menu/items' + qs);
  },
  menuItemCreate(data)         { return this.post('/menu/items', data); },
  menuItemUpdate(id, data)     { return this.put(`/menu/items/${id}`, data); },
  menuItemDelete(id)           { return this.delete(`/menu/items/${id}`); },

  auditLog(params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v)).toString();
    return this.get('/audit' + (qs ? '?' + qs : ''));
  },

  updateProfile(data)   { return this.put('/auth/profile', data); },
  changePassword(data)  { return this.put('/auth/password', data); },
  forgotPassword(email) { return this.post('/auth/forgot-password', { email }); },
  resetPassword(data)   { return this.post('/auth/reset-password', data); },

  paymentConfig()           { return this.get('/payments/config'); },
  bill(orderId)             { return this.get(`/payments/order/${orderId}`); },
  payments(locId)           { return this.get('/payments' + (locId ? `?location_id=${locId}` : '')); },
  recordPayment(data)       { return this.post('/payments', data); },
  paymentIntent(data)       { return this.post('/payments/intent', data); },
  confirmPayment(id)        { return this.post(`/payments/${id}/confirm`, {}); },
  refundPayment(id)         { return this.post(`/payments/${id}/refund`, {}); },

  analytics(params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v)).toString();
    return this.get('/analytics' + (qs ? '?' + qs : ''));
  },
};
