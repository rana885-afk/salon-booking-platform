require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const id = parseInt(process.argv[2], 10);

(async () => {
  try {
    if (!id) { console.log('Usage: node complete.js APPOINTMENT_ID'); return; }
    const r = await pool.query(
      "UPDATE booking.appointments SET status = 'completed' WHERE id = $1 RETURNING id, status, start_time",
      [id]
    );
    console.log(r.rows.length ? r.rows[0] : 'No appointment with that id');
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await pool.end();
  }
})();