require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const email = process.argv[2];
const role = process.argv[3];

(async () => {
  try {
    if (!email || !['customer', 'stylist', 'owner'].includes(role)) {
      console.log('Usage: node set-role.js EMAIL customer|stylist|owner');
      return;
    }
    const r = await pool.query(
      'UPDATE public.users SET role = $2 WHERE email = $1 RETURNING id, email, role',
      [email, role]
    );
    console.log(r.rows.length ? r.rows[0] : 'No user with that email');
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await pool.end();
  }
})();