require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const stylistId = parseInt(process.argv[2], 10);
const userId = parseInt(process.argv[3], 10);

(async () => {
  try {
    if (!stylistId || !userId) {
      console.log('Usage: node link-stylist.js STYLIST_ID USER_ID');
      return;
    }
    const r = await pool.query(
      'UPDATE catalog.stylists SET user_id = $2 WHERE id = $1 RETURNING id, salon_id, user_id, name',
      [stylistId, userId]
    );
    console.log(r.rows.length ? r.rows[0] : 'No stylist with that id');
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await pool.end();
  }
})();