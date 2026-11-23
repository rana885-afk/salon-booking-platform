const express = require('express');
const pool = require('./db');
const { verifyToken, requireRole } = require('./middleware');

const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Returns 'ok', 'not_found' or 'forbidden'
async function checkStylistOwner(stylistId, userId) {
  const result = await pool.query(
    `SELECT sa.owner_id
     FROM catalog.stylists st
     JOIN catalog.salons sa ON sa.id = st.salon_id
     WHERE st.id = $1`,
    [stylistId]
  );
  if (result.rows.length === 0) return 'not_found';
  return result.rows[0].owner_id === userId ? 'ok' : 'forbidden';
}

// PUT /stylists/:id/working-hours (owner of the salon only)
// body: { "hours": [ { "weekday": 1, "start_time": "09:00", "end_time": "17:00" } ] }
router.put('/:id/working-hours', verifyToken, requireRole('owner'), async (req, res) => {
  const stylistId = parseInt(req.params.id, 10);
  const { hours } = req.body;

  if (!stylistId) {
    return res.status(400).json({ error: 'invalid stylist id' });
  }
  if (!Array.isArray(hours)) {
    return res.status(400).json({ error: 'hours must be an array' });
  }

  const seen = new Set();
  for (const h of hours) {
    const validDay = Number.isInteger(h.weekday) && h.weekday >= 0 && h.weekday <= 6;
    const validTimes = TIME_RE.test(h.start_time) && TIME_RE.test(h.end_time) && h.start_time < h.end_time;
    if (!validDay || !validTimes || seen.has(h.weekday)) {
      return res.status(400).json({
        error: 'each item needs a unique weekday (0-6), and start_time before end_time (HH:MM)'
      });
    }
    seen.add(h.weekday);
  }

  try {
    const check = await checkStylistOwner(stylistId, req.user.userId);
    if (check === 'not_found') {
      return res.status(404).json({ error: 'Stylist not found' });
    }
    if (check === 'forbidden') {
      return res.status(403).json({ error: 'You do not own this salon' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM catalog.working_hours WHERE stylist_id = $1', [stylistId]);
    for (const h of hours) {
      await client.query(
        `INSERT INTO catalog.working_hours (stylist_id, weekday, start_time, end_time)
         VALUES ($1, $2, $3, $4)`,
        [stylistId, h.weekday, h.start_time, h.end_time]
      );
    }
    await client.query('COMMIT');

    const result = await pool.query(
      `SELECT weekday, start_time, end_time
       FROM catalog.working_hours
       WHERE stylist_id = $1
       ORDER BY weekday`,
      [stylistId]
    );
    res.json(result.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// POST /stylists/:id/time-off (owner of the salon only)
// body: { "from_time": "2026-12-01T00:00:00Z", "to_time": "2026-12-03T00:00:00Z" }
router.post('/:id/time-off', verifyToken, requireRole('owner'), async (req, res) => {
  const stylistId = parseInt(req.params.id, 10);
  const from = new Date(req.body.from_time);
  const to = new Date(req.body.to_time);

  if (!stylistId) {
    return res.status(400).json({ error: 'invalid stylist id' });
  }
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) {
    return res.status(400).json({ error: 'from_time and to_time are required and from_time must be before to_time' });
  }

  try {
    const check = await checkStylistOwner(stylistId, req.user.userId);
    if (check === 'not_found') {
      return res.status(404).json({ error: 'Stylist not found' });
    }
    if (check === 'forbidden') {
      return res.status(403).json({ error: 'You do not own this salon' });
    }

    const result = await pool.query(
      `INSERT INTO catalog.time_off (stylist_id, from_time, to_time)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [stylistId, from.toISOString(), to.toISOString()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

const SLOT_STEP_MINUTES = 30;

function isValidDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

// Asks the Booking service which slots of this stylist are already taken.
// Booking returns: [ { "start_time": "...", "end_time": "..." } ]
async function getBookedSlots(stylistId, date, authHeader) {
  if (!process.env.BOOKING_URL) return [];
  const url = `${process.env.BOOKING_URL}/appointments/booked-slots?stylistId=${stylistId}&date=${date}`;
  const response = await fetch(url, { headers: { Authorization: authHeader } });
  if (!response.ok) throw new Error('Booking service error');
  return response.json();
}

// GET /stylists/:id/availability?date=2026-12-01&serviceId=1 (customer)
router.get('/:id/availability', verifyToken, requireRole('customer'), async (req, res) => {
  const stylistId = parseInt(req.params.id, 10);
  const serviceId = parseInt(req.query.serviceId, 10);
  const date = req.query.date;

  if (!stylistId || !serviceId || !isValidDate(date)) {
    return res.status(400).json({ error: 'a valid stylist id, serviceId and date (YYYY-MM-DD) are required' });
  }

  try {
    // The service must belong to the same salon as the stylist
    const info = await pool.query(
      `SELECT sv.duration_minutes
       FROM catalog.stylists st
       JOIN catalog.services sv ON sv.salon_id = st.salon_id AND sv.id = $2
       WHERE st.id = $1`,
      [stylistId, serviceId]
    );
    if (info.rows.length === 0) {
      return res.status(404).json({ error: 'Stylist or service not found' });
    }
    const durationMs = info.rows[0].duration_minutes * 60000;

    const dayStart = new Date(`${date}T00:00:00Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60000);
    const weekday = dayStart.getUTCDay();

    const hours = await pool.query(
      'SELECT start_time, end_time FROM catalog.working_hours WHERE stylist_id = $1 AND weekday = $2',
      [stylistId, weekday]
    );
    if (hours.rows.length === 0) {
      return res.json({ date, stylist_id: stylistId, service_id: serviceId, slots: [] });
    }

    const timeOff = await pool.query(
      `SELECT from_time, to_time FROM catalog.time_off
       WHERE stylist_id = $1 AND from_time < $3 AND to_time > $2`,
      [stylistId, dayStart.toISOString(), dayEnd.toISOString()]
    );

    let booked;
    try {
      booked = await getBookedSlots(stylistId, date, req.headers.authorization);
    } catch (err) {
      return res.status(502).json({ error: 'Booking service unavailable' });
    }

    const blocked = [
      ...timeOff.rows.map(r => ({ start: new Date(r.from_time).getTime(), end: new Date(r.to_time).getTime() })),
      ...booked.map(b => ({ start: new Date(b.start_time).getTime(), end: new Date(b.end_time).getTime() }))
    ];

    const workStart = new Date(`${date}T${hours.rows[0].start_time}Z`).getTime();
    const workEnd = new Date(`${date}T${hours.rows[0].end_time}Z`).getTime();

    const slots = [];
    for (let s = workStart; s + durationMs <= workEnd; s += SLOT_STEP_MINUTES * 60000) {
      const e = s + durationMs;
      const clash = blocked.some(b => s < b.end && e > b.start);
      if (!clash) {
        slots.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
      }
    }

    res.json({ date, stylist_id: stylistId, service_id: serviceId, slots });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /stylists/mine (stylist: my own profiles)
router.get('/mine', verifyToken, requireRole('stylist'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, salon_id, name FROM catalog.stylists WHERE user_id = $1',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;