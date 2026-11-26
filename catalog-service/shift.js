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
    if (!id) { console.log('Usage: node shift.js APPOINTMENT_ID'); return; }

    const found = await pool.query(
      `SELECT table_schema, table_name
       FROM information_schema.columns
       WHERE column_name = 'start_time'
         AND table_schema NOT IN ('pg_catalog', 'information_schema', 'catalog')
         AND (table_schema, table_name) IN (
           SELECT table_schema, table_name FROM information_schema.columns WHERE column_name = 'end_time'
         )
         AND (table_schema, table_name) IN (
           SELECT table_schema, table_name FROM information_schema.columns WHERE column_name = 'status'
         )`
    );

    if (found.rows.length !== 1) {
      console.log('Expected one appointments table, found:');
      console.table(found.rows);
      return;
    }

    const { table_schema, table_name } = found.rows[0];
    console.log('Using table:', table_schema + '.' + table_name);

    const r = await pool.query(
      `UPDATE "${table_schema}"."${table_name}"
       SET start_time = NOW() - INTERVAL '3 hours',
           end_time = NOW() - INTERVAL '3 hours' + (end_time - start_time)
       WHERE id = $1
       RETURNING id, status, start_time, end_time`,
      [id]
    );
    console.log(r.rows.length ? r.rows[0] : 'No appointment with that id');
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await pool.end();
  }
})();