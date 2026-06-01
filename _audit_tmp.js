const db = require('./db/database');
const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x => x.name);
console.log('LIVE table count:', t.length);
console.log(t.join(', '));
