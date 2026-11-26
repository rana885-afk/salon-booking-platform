require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const action = process.argv[2];
const ids = process.argv.slice(3).map(n => parseInt(n, 10)).filter(Boolean);

(async () => {
  try {
    if (action === 'list') {
      const r = await pool.query(
        'SELECT id, salon_id, customer_id, appointment_id, rating, comment, created_at FROM catalog.reviews ORDER BY id'
      );
      console.table(r.rows);
    } else if (action === 'delete' && ids.length > 0) {
      const r = await pool.query(
        'DELETE FROM catalog.reviews WHERE id = ANY($1::int[]) RETURNING id, rating, comment',
        [ids]
      );
      console.log('Deleted:');
      console.table(r.rows);
    } else {
      console.log('Usage:');
      console.log('  node admin.js list');
      console.log('  node admin.js delete ID [ID ...]');
    }
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await pool.end();
  }
})();