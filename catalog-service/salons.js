const express = require('express');
const pool = require('./db');
const { verifyToken, requireRole } = require('./middleware');

const router = express.Router();

// POST /salons (owner only)
router.post('/', verifyToken, requireRole('owner'), async (req, res) => {
  const { name, address, city, latitude, longitude } = req.body;
  if (!name || !address || !city) {
    return res.status(400).json({ error: 'name, address and city are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO catalog.salons (owner_id, name, address, city, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.userId, name, address, city, latitude || null, longitude || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /salons?city=&service=&minRating=  (public)
router.get('/', async (req, res) => {
  const { city, service, minRating } = req.query;
  const conditions = [];
  const values = [];

  if (city) {
    values.push(city);
    conditions.push(`LOWER(s.city) = LOWER($${values.length})`);
  }
  if (service) {
    values.push(`%${service}%`);
    conditions.push(
      `EXISTS (SELECT 1 FROM catalog.services sv
               WHERE sv.salon_id = s.id AND sv.name ILIKE $${values.length})`
    );
  }
  if (minRating !== undefined) {
    const rating = Number(minRating);
    if (isNaN(rating) || rating < 0 || rating > 5) {
      return res.status(400).json({ error: 'minRating must be a number between 0 and 5' });
    }
    values.push(rating);
    conditions.push(`s.average_rating >= $${values.length}`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const result = await pool.query(
      `SELECT s.id, s.name, s.address, s.city, s.latitude, s.longitude, s.average_rating
       FROM catalog.salons s
       ${where}
       ORDER BY s.average_rating DESC, s.name`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /salons/mine (owner: the salons I own)
router.get('/mine', verifyToken, requireRole('owner'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, address, city, average_rating
       FROM catalog.salons
       WHERE owner_id = $1
       ORDER BY id`,
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /salons/:id/services (owner of this salon only)
router.post('/:id/services', verifyToken, requireRole('owner'), async (req, res) => {
  const salonId = parseInt(req.params.id, 10);
  const { name, price, duration_minutes } = req.body;

  if (!salonId) {
    return res.status(400).json({ error: 'invalid salon id' });
  }
  if (!name || typeof price !== 'number' || price < 0 ||
      !Number.isInteger(duration_minutes) || duration_minutes <= 0) {
    return res.status(400).json({ error: 'name, price (>= 0) and duration_minutes (> 0) are required' });
  }

  try {
    const salon = await pool.query('SELECT owner_id FROM catalog.salons WHERE id = $1', [salonId]);
    if (salon.rows.length === 0) {
      return res.status(404).json({ error: 'Salon not found' });
    }
    if (salon.rows[0].owner_id !== req.user.userId) {
      return res.status(403).json({ error: 'You do not own this salon' });
    }

    const result = await pool.query(
      `INSERT INTO catalog.services (salon_id, name, price, duration_minutes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [salonId, name, price, duration_minutes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /salons/:id/services (public)
router.get('/:id/services', async (req, res) => {
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
      'SELECT id, name, price, duration_minutes FROM catalog.services WHERE salon_id = $1 ORDER BY name',
      [salonId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /salons/:id/stylists (owner of this salon only)
router.post('/:id/stylists', verifyToken, requireRole('owner'), async (req, res) => {
  const salonId = parseInt(req.params.id, 10);
  const { name, user_id } = req.body;

  if (!salonId) {
    return res.status(400).json({ error: 'invalid salon id' });
  }
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (user_id !== undefined && !Number.isInteger(user_id)) {
    return res.status(400).json({ error: 'user_id must be a number' });
  }

  try {
    const salon = await pool.query('SELECT owner_id FROM catalog.salons WHERE id = $1', [salonId]);
    if (salon.rows.length === 0) {
      return res.status(404).json({ error: 'Salon not found' });
    }
    if (salon.rows[0].owner_id !== req.user.userId) {
      return res.status(403).json({ error: 'You do not own this salon' });
    }

    const result = await pool.query(
      `INSERT INTO catalog.stylists (salon_id, name, user_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [salonId, name, user_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /salons/:id/stylists (public)
router.get('/:id/stylists', async (req, res) => {
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
      'SELECT id, name FROM catalog.stylists WHERE salon_id = $1 ORDER BY name',
      [salonId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Checks with the Booking service that this customer has a completed appointment in this salon
async function verifyCompletedAppointment(salonId, appointmentId, userId, authHeader) {
  if (process.env.SKIP_APPOINTMENT_CHECK === 'true') return true; // local testing only

  if (!process.env.BOOKING_URL) throw new Error('Booking service not configured');
  const response = await fetch(`${process.env.BOOKING_URL}/appointments`, {
    headers: { Authorization: authHeader }
  });
  if (!response.ok) throw new Error('Booking service error');

  const appointments = await response.json();
  const appointment = appointments.find(a => a.id === appointmentId);
  if (!appointment || appointment.customer_id !== userId || appointment.status !== 'completed') {
    return false;
  }

  const stylist = await pool.query(
    'SELECT 1 FROM catalog.stylists WHERE id = $1 AND salon_id = $2',
    [appointment.stylist_id, salonId]
  );
  return stylist.rows.length > 0;
}

// POST /salons/:id/reviews (customer with a completed appointment, once per appointment)
router.post('/:id/reviews', verifyToken, requireRole('customer'), async (req, res) => {
  const salonId = parseInt(req.params.id, 10);
  const { appointment_id, rating, comment } = req.body;

  if (!salonId || !Number.isInteger(appointment_id) ||
      !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'appointment_id and a rating between 1 and 5 are required' });
  }

  try {
    const salon = await pool.query('SELECT id FROM catalog.salons WHERE id = $1', [salonId]);
    if (salon.rows.length === 0) {
      return res.status(404).json({ error: 'Salon not found' });
    }

    let allowed;
    try {
      allowed = await verifyCompletedAppointment(salonId, appointment_id, req.user.userId, req.headers.authorization);
    } catch (err) {
      return res.status(502).json({ error: 'Booking service unavailable' });
    }
    if (!allowed) {
      return res.status(403).json({ error: 'Only customers with a completed appointment in this salon can review' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const review = await client.query(
        `INSERT INTO catalog.reviews (salon_id, customer_id, appointment_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [salonId, req.user.userId, appointment_id, rating, comment || null]
      );
      const updated = await client.query(
        `UPDATE catalog.salons
         SET average_rating = (SELECT ROUND(AVG(rating)::numeric, 1) FROM catalog.reviews WHERE salon_id = $1)
         WHERE id = $1
         RETURNING average_rating`,
        [salonId]
      );
      await client.query('COMMIT');
      res.status(201).json({ ...review.rows[0], salon_average_rating: updated.rows[0].average_rating });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        return res.status(409).json({ error: 'This appointment was already reviewed' });
      }
      res.status(500).json({ error: 'Server error' });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /salons/:id/reviews (public)
router.get('/:id/reviews', async (req, res) => {
  const salonId = parseInt(req.params.id, 10);
  if (!salonId) {
    return res.status(400).json({ error: 'invalid salon id' });
  }
  try {
    const salon = await pool.query('SELECT average_rating FROM catalog.salons WHERE id = $1', [salonId]);
    if (salon.rows.length === 0) {
      return res.status(404).json({ error: 'Salon not found' });
    }
    const reviews = await pool.query(
      `SELECT id, rating, comment, created_at
       FROM catalog.reviews
       WHERE salon_id = $1
       ORDER BY created_at DESC`,
      [salonId]
    );
    res.json({ average_rating: salon.rows[0].average_rating, reviews: reviews.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; 
