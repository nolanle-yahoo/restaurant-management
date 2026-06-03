require('dotenv').config();

const WEAK_SECRET = 'restaurant_super_secret_key_2024';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === WEAK_SECRET) {
  console.error('ERROR: JWT_SECRET is missing or uses the insecure default. Set a strong random value in .env before starting the server.');
  process.exit(1);
}

const http    = require('http');
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const ws      = require('./lib/ws');

const app = express();
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Path split (shared back-end + API): the customer site lives at '/', the staff
// app at '/staff'. Register these before express.static so the static directory
// index doesn't claim '/'.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));
app.get(['/staff', '/staff/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const { createSchema } = require('./db/schema');
createSchema();

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/employees',    require('./routes/employees'));
app.use('/api/clock',        require('./routes/clock'));
app.use('/api/areas',        require('./routes/areas'));
app.use('/api/tables',       require('./routes/tables'));
app.use('/api/orders',       require('./routes/orders'));
app.use('/api/inventory',    require('./routes/inventory'));
app.use('/api/locations',    require('./routes/locations'));
app.use('/api/timesheets',   require('./routes/timesheets'));
app.use('/api/time-off',     require('./routes/timeoff'));
app.use('/api/messages',     require('./routes/messages'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/menu',         require('./routes/menu'));
app.use('/api/audit',        require('./routes/audit'));
app.use('/api/payments',     require('./routes/payments'));
app.use('/api/analytics',    require('./routes/analytics'));
app.use('/api/settings',     require('./routes/settings'));
app.use('/api/marketing',    require('./routes/marketing'));
app.use('/api/announcements',require('./routes/announcements'));
app.use('/api/feedback',     require('./routes/feedback'));
app.use('/api/waitlist',     require('./routes/waitlist'));
app.use('/api/schedules',    require('./routes/schedules'));
app.use('/api/shift-swaps',  require('./routes/shift-swaps'));
app.use('/api/regions',      require('./routes/regions'));
app.use('/api/deliveries',   require('./routes/deliveries'));
app.use('/api/customers',    require('./routes/customers'));
app.use('/api/public',       require('./routes/public'));

// Unknown routes fall back to the customer site (not the staff login).
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'An unexpected error occurred' });
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
ws.init(server);
require('./lib/reminders').start();
server.listen(PORT, () => console.log(`Restaurant server running on http://localhost:${PORT}`));
