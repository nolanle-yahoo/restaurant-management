const db = require('./database');

const employees = [
  [2,  1, 8.0],  // Marco Rivera - manager
  [8,  1, 8.0],  // Nina Patel - stockroom
  [9,  1, 8.0],  // Antonio Garcia - chef
  [14, 1, 8.0],  // Emily Johnson - waiter
  [15, 1, 7.5],  // Carlos Diaz - waiter
  [18, 1, 8.0],  // Jessica Lee - frontdesk
  [21, 1, 7.0],  // Ryan Torres - employee
  [22, 1, 6.5],  // Mia Wong - employee

  [3,  2, 8.0],  // Priya Sharma - manager
  [7,  2, 8.0],  // David Park - stockroom
  [10, 2, 8.0],  // Yuki Tanaka - chef
  [16, 2, 7.5],  // Amara Nwosu - waiter
  [19, 2, 8.0],  // Omar Hassan - frontdesk
  [23, 2, 6.5],  // Ethan Brown - employee

  [4,  3, 8.0],  // James Okafor - manager
  [11, 3, 8.0],  // Olu Adeyemi - chef
  [17, 3, 7.5],  // Tom Baker - waiter
  [20, 3, 8.0],  // Claire Dupont - frontdesk
  [24, 3, 6.0],  // Zara Ahmed - employee

  [5,  4, 8.0],  // Sofia Martinez - manager
  [12, 4, 8.0],  // Rosa Mendez - chef
  [25, 4, 7.0],  // Lucas Silva - employee

  [6,  5, 8.0],  // Lena Kim - manager
  [13, 5, 8.0],  // Hans Mueller - chef
  [26, 5, 6.5],  // Aisha Diallo - employee
];

const insert = db.prepare(`
  INSERT INTO clock_records (user_id, location_id, check_in, check_out, hours_worked)
  VALUES (?, ?, ?, ?, ?)
`);

db.exec(`DELETE FROM clock_records WHERE check_out IS NOT NULL`);

function toSQLite(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

let count = 0;
const today = new Date();

for (let d = 21; d >= 1; d--) {
  const workDate = new Date(today);
  workDate.setDate(today.getDate() - d);
  if (workDate.getDay() === 0) continue; // skip Sunday

  employees.forEach(([uid, lid, baseHrs]) => {
    const variation = (Math.round((Math.random() - 0.5)) * 0.5);
    const hrs = Math.max(4, baseHrs + variation);
    const startHour = (uid % 2 === 0) ? 8 : 9;

    const checkIn = new Date(workDate);
    checkIn.setHours(startHour, 0, 0, 0);

    const checkOut = new Date(checkIn);
    checkOut.setMinutes(checkOut.getMinutes() + hrs * 60);

    insert.run(uid, lid, toSQLite(checkIn), toSQLite(checkOut), hrs);
    count++;
  });
}

console.log(`Added ${count} clock records across 3 weeks for ${employees.length} employees.`);
