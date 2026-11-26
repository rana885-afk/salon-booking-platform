require('dotenv').config();
const express = require('express');
const pool = require('./db');

const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.json());
app.use('/auth', require('./auth'));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});