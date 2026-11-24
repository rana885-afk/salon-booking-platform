const express = require('express');
const pool = require('./db');
const { verifyToken, requireRole } = require('./middleware');

const router = express.Router();

async function callService(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, body };
}

// Sends a notification to the Notification service. Never throws:
// the appointment is already saved, so a failed email must not break the booking.
async function notify(path, body) {
  if (!process.env.NOTIFICATION_URL) return;
  try {
    const response = await fetch(`${process.env.NOTIFICATION_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) console.error(`Notification ${path} returned ${response.status}`);
  } catch (err) {
    console.error(`Notification ${path} failed: ${err.message}`);
  }
}

// Asks the Catalog which salons (owner) or stylist profiles (stylist) belong to this user
async function getMyIds(user, authHeader) {
  const path = user.role === 'owner' ? '/salons/mine' : '/stylists/mine';
  const result = await callService(`${process.env.CATALOG_URL}${path}`, {
    headers: { Authorization: authHeader }
  });
  if (!result.ok) throw new Error('Catalog error');
  return result.body.map(item => item.id);
}

// POST /appointments (customer)
// body: { "salon_id": 1, "stylist_id": 1, "service_id": 1, "start_time": "2026-12-01T09:00:00Z" }
router.post('/', verifyToken, requireRole('customer'), async (req, res) => {
  const { salon_id, stylist_id, service_id, start_time } = req.body;
  const start = new Date(start_time);

  if (!Number.isInteger(salon_id) || !Number.isInteger(stylist_id) ||
      !Number.isInteger(service_id) || isNaN(start.getTime())) {
    return res.status(400).json({ error: 'salon_id, stylist_id, service_id and a valid start_time are required' });
  }
  if (start <= new Date()) {
    return res.status(400).json({ error: 'start_time must be in the future' });
  }

  const catalog = process.env.CATALOG_URL;
  let service;

  try {
    // 1. The stylist and the service must belong to this salon
    const stylists = await callService(`${catalog}/salons/${salon_id}/stylists`);
    if (stylists.status === 404) {
      return res.status(404).json({ error: 'Salon not found' });
    }
    if (!stylists.ok) throw new Error('Catalog error');
    if (!stylists.body.some(s => s.id === stylist_id)) {
      return res.status(404).json({ error: 'Stylist not found in this salon' });
    }

    const services = await callService(`${catalog}/salons/${salon_id}/services`);
    if (!services.ok) throw new Error('Catalog error');
    service = services.body.find(s => s.id === service_id);
    if (!service) {
      return res.status(404).json({ error: 'Service not found in this salon' });
    }

    // 2. The time must be one of the free slots of the stylist
    const date = start.toISOString().slice(0, 10);
    const availability = await callService(
      `${catalog}/stylists/${stylist_id}/availability?date=${date}&serviceId=${service_id}`,
      { headers: { Authorization: req.headers.authorization } }
    );
    if (!availability.ok) throw new Error('Catalog error');
    const free = availability.body.slots.some(s => new Date(s.start).getTime() === start.getTime());
    if (!free) {
      return res.status(409).json({ error: 'This time slot is not available' });
    }
  } catch (err) {
    return res.status(502).json({ error: 'Catalog service unavailable' });
  }

  // 3. Price and end time are calculated here, never taken from the customer
  const end = new Date(start.getTime() + service.duration_minutes * 60000);

  let appointment;
  try {
    const result = await pool.query(
      `INSERT INTO booking.appointments
         (customer_id, salon_id, stylist_id, service_id, start_time, end_time, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.user.userId, salon_id, stylist_id, service_id,
       start.toISOString(), end.toISOString(), service.price]
    );
    appointment = result.rows[0];
  } catch (err) {
    // 23P01 = the database refused it because of the no_double_booking constraint
    if (err.code === '23P01') {
      return res.status(409).json({ error: 'This time slot is already booked' });
    }
    return res.status(500).json({ error: 'Server error' });
  }

  // 4. Confirmation email now, reminder 24 hours before (not awaited on purpose)
  notify('/notifications/email', {
    userId: req.user.userId,
    appointmentId: appointment.id,
    type: 'confirmation',
    email: req.user.email
  });
  notify('/notifications/reminders', {
    userId: req.user.userId,
    appointmentId: appointment.id,
    email: req.user.email,
    appointmentTime: appointment.start_time
  });

  res.status(201).json(appointment);
});

function isValidDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

// GET /appointments/booked-slots?stylistId=1&date=2026-12-01
// Internal: called by the Catalog service to calculate availability
router.get('/booked-slots', verifyToken, async (req, res) => {
  const stylistId = parseInt(req.query.stylistId, 10);
  const date = req.query.date;

  if (!stylistId || !isValidDate(date)) {
    return res.status(400).json({ error: 'stylistId and a valid date (YYYY-MM-DD) are required' });
  }

  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60000);

  try {
    const result = await pool.query(
      `SELECT start_time, end_time
       FROM booking.appointments
       WHERE stylist_id = $1
         AND status <> 'cancelled'
         AND start_time < $3
         AND end_time > $2
       ORDER BY start_time`,
      [stylistId, dayStart.toISOString(), dayEnd.toISOString()]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /appointments?status=pending
// customer: own appointments | owner: appointments of their salons | stylist: their own schedule
router.get('/', verifyToken, requireRole('customer', 'owner', 'stylist'), async (req, res) => {
  const { status } = req.query;
  const allowed = ['pending', 'confirmed', 'completed', 'cancelled'];

  if (status !== undefined && !allowed.includes(status)) {
    return res.status(400).json({ error: 'status must be pending, confirmed, completed or cancelled' });
  }

  const values = [];
  let condition;

  try {
    if (req.user.role === 'customer') {
      values.push(req.user.userId);
      condition = 'customer_id = $1';
    } else {
      let ids;
      try {
        ids = await getMyIds(req.user, req.headers.authorization);
      } catch (err) {
        return res.status(502).json({ error: 'Catalog service unavailable' });
      }
      if (ids.length === 0) {
        return res.json([]);
      }
      values.push(ids);
      condition = req.user.role === 'owner' ? 'salon_id = ANY($1)' : 'stylist_id = ANY($1)';
    }

    if (status) {
      values.push(status);
      condition += ` AND status = $${values.length}`;
    }

    const result = await pool.query(
      `SELECT id, customer_id, salon_id, stylist_id, service_id,
              start_time, end_time, price, status
       FROM booking.appointments
       WHERE ${condition}
       ORDER BY start_time DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /appointments/:id/status (owner of the salon or the stylist of the appointment)
// body: { "status": "confirmed" } or { "status": "completed" }
router.put('/:id/status', verifyToken, requireRole('owner', 'stylist'), async (req, res) => {
  const appointmentId = parseInt(req.params.id, 10);
  const { status } = req.body;

  if (!appointmentId || !['confirmed', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'a valid appointment id and status (confirmed or completed) are required' });
  }

  let appointment;
  try {
    const found = await pool.query('SELECT * FROM booking.appointments WHERE id = $1', [appointmentId]);
    appointment = found.rows[0];
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
  if (!appointment) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  // The appointment must be in this user's schedule
  try {
    const ids = await getMyIds(req.user, req.headers.authorization);
    const mine = req.user.role === 'owner' ? appointment.salon_id : appointment.stylist_id;
    if (!ids.includes(mine)) {
      return res.status(403).json({ error: 'This appointment is not in your schedule' });
    }
  } catch (err) {
    return res.status(502).json({ error: 'Catalog service unavailable' });
  }

  // Allowed moves: pending -> confirmed, confirmed -> completed (only after it started)
  const required = status === 'confirmed' ? 'pending' : 'confirmed';
  if (appointment.status !== required) {
    return res.status(409).json({ error: `Only a ${required} appointment can be marked as ${status}` });
  }
  if (status === 'completed' && new Date(appointment.start_time) > new Date()) {
    return res.status(409).json({ error: 'An appointment can only be completed after it started' });
  }

  try {
    const result = await pool.query(
      `UPDATE booking.appointments
       SET status = $2
       WHERE id = $1 AND status = $3
       RETURNING *`,
      [appointmentId, status, required]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'The appointment status has just changed, try again' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

const CANCELLATION_WINDOW_HOURS = 24;

// DELETE /appointments/:id (customer cancels their own appointment)
router.delete('/:id', verifyToken, requireRole('customer'), async (req, res) => {
  const appointmentId = parseInt(req.params.id, 10);
  if (!appointmentId) {
    return res.status(400).json({ error: 'invalid appointment id' });
  }

  try {
    const found = await pool.query('SELECT * FROM booking.appointments WHERE id = $1', [appointmentId]);
    const appointment = found.rows[0];

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (appointment.customer_id !== req.user.userId) {
      return res.status(403).json({ error: 'This is not your appointment' });
    }
    if (!['pending', 'confirmed'].includes(appointment.status)) {
      return res.status(403).json({ error: `A ${appointment.status} appointment cannot be cancelled` });
    }

    const hoursLeft = (new Date(appointment.start_time).getTime() - Date.now()) / 3600000;
    if (hoursLeft < CANCELLATION_WINDOW_HOURS) {
      return res.status(403).json({
        error: `Cancellation is only allowed at least ${CANCELLATION_WINDOW_HOURS} hours before the appointment`
      });
    }

    await pool.query(
      `UPDATE booking.appointments
       SET status = 'cancelled'
       WHERE id = $1 AND status IN ('pending', 'confirmed')`,
      [appointmentId]
    );

    notify('/notifications/email', {
      userId: req.user.userId,
      appointmentId,
      type: 'cancellation',
      email: req.user.email
    });

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /appointments/:id (customer reschedules their own appointment)
// body: { "start_time": "2026-12-08T10:00:00Z" }
router.put('/:id', verifyToken, requireRole('customer'), async (req, res) => {
  const appointmentId = parseInt(req.params.id, 10);
  const start = new Date(req.body.start_time);

  if (!appointmentId || isNaN(start.getTime())) {
    return res.status(400).json({ error: 'a valid appointment id and start_time are required' });
  }
  if (start <= new Date()) {
    return res.status(400).json({ error: 'start_time must be in the future' });
  }

  let appointment;
  try {
    const found = await pool.query('SELECT * FROM booking.appointments WHERE id = $1', [appointmentId]);
    appointment = found.rows[0];
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }

  if (!appointment) {
    return res.status(404).json({ error: 'Appointment not found' });
  }
  if (appointment.customer_id !== req.user.userId) {
    return res.status(403).json({ error: 'This is not your appointment' });
  }
  if (!['pending', 'confirmed'].includes(appointment.status)) {
    return res.status(403).json({ error: `A ${appointment.status} appointment cannot be rescheduled` });
  }

  const hoursLeft = (new Date(appointment.start_time).getTime() - Date.now()) / 3600000;
  if (hoursLeft < CANCELLATION_WINDOW_HOURS) {
    return res.status(403).json({
      error: `Rescheduling is only allowed at least ${CANCELLATION_WINDOW_HOURS} hours before the appointment`
    });
  }
  if (start.getTime() === new Date(appointment.start_time).getTime()) {
    return res.status(400).json({ error: 'the new start_time is the same as the current one' });
  }

  // Ask the Catalog for the service duration and check the new time is free
  const catalog = process.env.CATALOG_URL;
  let service;
  try {
    const services = await callService(`${catalog}/salons/${appointment.salon_id}/services`);
    if (!services.ok) throw new Error('Catalog error');
    service = services.body.find(s => s.id === appointment.service_id);
    if (!service) {
      return res.status(404).json({ error: 'Service no longer exists' });
    }

    const date = start.toISOString().slice(0, 10);
    const availability = await callService(
      `${catalog}/stylists/${appointment.stylist_id}/availability?date=${date}&serviceId=${appointment.service_id}`,
      { headers: { Authorization: req.headers.authorization } }
    );
    if (!availability.ok) throw new Error('Catalog error');
    const free = availability.body.slots.some(s => new Date(s.start).getTime() === start.getTime());
    if (!free) {
      return res.status(409).json({ error: 'This time slot is not available' });
    }
  } catch (err) {
    return res.status(502).json({ error: 'Catalog service unavailable' });
  }

  const end = new Date(start.getTime() + service.duration_minutes * 60000);

  let updated;
  try {
    const result = await pool.query(
      `UPDATE booking.appointments
       SET start_time = $2, end_time = $3
       WHERE id = $1 AND status IN ('pending', 'confirmed')
       RETURNING *`,
      [appointmentId, start.toISOString(), end.toISOString()]
    );
    updated = result.rows[0];
  } catch (err) {
    if (err.code === '23P01') {
      return res.status(409).json({ error: 'This time slot is already booked' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
  if (!updated) {
    return res.status(409).json({ error: 'The appointment can no longer be rescheduled' });
  }

  // Email now, and a new reminder (the old one is skipped by the scheduler)
  notify('/notifications/email', {
    userId: req.user.userId,
    appointmentId,
    type: 'reschedule',
    email: req.user.email
  });
  notify('/notifications/reminders', {
    userId: req.user.userId,
    appointmentId,
    email: req.user.email,
    appointmentTime: updated.start_time
  });

  res.json(updated);
});

router.get('/:id', verifyToken, requireRole('customer'), async (req, res) => {
  const appointmentId = parseInt(req.params.id, 10);
  if (!appointmentId) {
    return res.status(400).json({ error: 'a valid appointment id is required' });
  }

  try {
    const found = await pool.query('SELECT * FROM booking.appointments WHERE id = $1', [appointmentId]);
    const appointment = found.rows[0];

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (appointment.customer_id !== req.user.userId) {
      return res.status(403).json({ error: 'This is not your appointment' });
    }
    res.json(appointment);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});


module.exports = router;

