require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

(async () => {
  try {
    const p = await pool.query(
      'SELECT id, appointment_id, amount, status FROM payment.payments ORDER BY id DESC LIMIT 10'
    );
    console.log('Payments:');
    console.table(p.rows);

    const a = await pool.query(
      'SELECT id, status, start_time FROM booking.appointments ORDER BY id DESC LIMIT 10'
    );
    console.log('Appointments:');
    console.table(a.rows);
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await pool.end();
  }
})();