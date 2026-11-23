const express = require('express');
const pool = require('./db');
const { verifyToken, requireRole } = require('./middleware');

const router = express.Router();

// POST /salons/:id/reviews (customer only)
router.post('/:id/reviews', verifyToken, requireRole('customer'), async (req, res) => {
  const salonId = parseInt(req.params.id, 10);
  const appointmentId = parseInt(req.body.appointment_id, 10);
  const rating = req.body.rating;
  const comment = req.body.comment;

  if (!salonId || !appointmentId) {
    return res.status(400).json({ error: 'a valid salon id and appointment_id are required' });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be a whole number from 1 to 5' });
  }
  if (comment !== undefined && comment !== null && typeof comment !== 'string') {
    return res.status(400).json({ error: 'comment must be text' });
  }

  try {
    const salon = await pool.query('SELECT id FROM catalog.salons WHERE id = $1', [salonId]);
    if (salon.rows.length === 0) {
      return res.status(404).json({ error: 'Salon not found' });
    }

    const result = await pool.query(
      `INSERT INTO catalog.reviews (salon_id, customer_id, appointment_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [salonId, req.user.userId, appointmentId, rating, comment || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This appointment already has a review' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /salons/:id/reviews (any logged-in user)
router.get('/:id/reviews', verifyToken, async (req, res) => {
  const salonId = parseInt(req.params.id, 10);
  if (!salonId) {
    return res.status(400).json({ error: 'invalid salon id' });
  }

  try {
    const salon = await pool.query('SELECT id FROM catalog.salons WHERE id = $1', [salonId]);
    if (salon.rows.length === 0) {
      return res.status(404).json({ error: 'Salon not found' });
    }

    const result = await pool.query(
      `SELECT id, customer_id, appointment_id, rating, comment, created_at
       FROM catalog.reviews
       WHERE salon_id = $1
       ORDER BY created_at DESC`,
      [salonId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /salons/:id/rating (any logged-in user)
router.get('/:id/rating', verifyToken, async (req, res) => {
  const salonId = parseInt(req.params.id, 10);
  if (!salonId) {
    return res.status(400).json({ error: 'invalid salon id' });
  }

  try {
    const salon = await pool.query('SELECT id FROM catalog.salons WHERE id = $1', [salonId]);
    if (salon.rows.length === 0) {
      return res.status(404).json({ error: 'Salon not found' });
    }

    const result = await pool.query(
      `SELECT COALESCE(ROUND(AVG(rating), 1), 0)::float AS average_rating,
              COUNT(*)::int AS review_count
       FROM catalog.reviews
       WHERE salon_id = $1`,
      [salonId]
    );
    res.json({ salon_id: salonId, ...result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;