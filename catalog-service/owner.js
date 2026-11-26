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
const salonName = process.argv[3];

(async () => {
  try {
    if (!email) { console.log('Usage: node owner.js EMAIL ["Salon Name"]'); return; }

    const u = await pool.query(
      "UPDATE public.users SET role = 'owner' WHERE email = $1 RETURNING id, email, role",
      [email]
    );
    if (u.rows.length === 0) { console.log('No user with that email'); return; }
    console.log(u.rows[0]);

    if (salonName) {
      const s = await pool.query(
        'UPDATE catalog.salons SET owner_id = $1 WHERE name = $2 RETURNING id, name, owner_id',
        [u.rows[0].id, salonName]
      );
      console.log(s.rows.length ? s.rows : 'No salon with that name');
    }
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await pool.end();
  }
})();