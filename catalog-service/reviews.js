const express = require('express');
const pool = require('./db');
const { verifyToken, requireRole } = require('./middleware');

const router = express.Router();

// Asks the Booking service for the appointment, using the customer's own token.
// The Booking service only returns appointments that belong to that customer.
async function getAppointment(appointmentId, authHeader) {
  const response = await fetch(`${process.env.BOOKING_URL}/appointments/${appointmentId}`, {
    headers: { Authorization: authHeader }
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, body };
}

// POST /salons/:id/reviews (customer only, completed appointment only)
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

    // The appointment must exist, belong to this customer, be in this salon and be completed
    let appointment;
    try {
      const result = await getAppointment(appointmentId, req.headers.authorization);
      if (result.status === 404 || result.status === 403) {
        return res.status(404).json({ error: 'Appointment not found' });
      }
      if (!result.ok) throw new Error('Booking error');
      appointment = result.body;
    } catch (err) {
      return res.status(502).json({ error: 'Booking service unavailable' });
    }

    if (appointment.salon_id !== salonId) {
      return res.status(400).json({ error: 'This appointment is not in this salon' });
    }
    if (appointment.status !== 'completed') {
      return res.status(403).json({ error: 'You can only review a completed appointment' });
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