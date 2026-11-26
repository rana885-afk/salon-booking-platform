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
    const s = await pool.query(
      'SELECT id, salon_id, user_id, name FROM catalog.stylists ORDER BY id'
    );
    console.log('Stylists:');
    console.table(s.rows);

    const u = await pool.query(
      'SELECT id, name, email, role FROM public.users ORDER BY id'
    );
    console.log('Users:');
    console.table(u.rows);
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await pool.end();
  }
})();