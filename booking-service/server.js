require('dotenv').config();
const express = require('express');
const pool = require('./db');

const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.json());
app.use('/appointments', require('./appointments'));
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

const PORT = process.env.PORT || 3004;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Booking service running on port ${PORT}`);
  });
}

module.exports = app;