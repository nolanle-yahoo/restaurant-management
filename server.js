require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const { createSchema } = require('./db/schema');
createSchema();

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/employees',   require('./routes/employees'));
app.use('/api/clock',       require('./routes/clock'));
app.use('/api/tables',      require('./routes/tables'));
app.use('/api/orders',      require('./routes/orders'));
app.use('/api/inventory',   require('./routes/inventory'));
app.use('/api/locations',   require('./routes/locations'));
app.use('/api/timesheets',  require('./routes/timesheets'));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Restaurant server running on http://localhost:${PORT}`));
