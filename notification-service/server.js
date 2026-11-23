require('dotenv').config();
const express = require('express');
const pool = require('./db');
const { startScheduler } = require('./scheduler');
const app = express();
app.use(express.json());
app.use('/notifications', require('./notifications'));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

const PORT = process.env.PORT || 3003;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Notification service running on port ${PORT}`);
    startScheduler();
  });
}

module.exports = app;