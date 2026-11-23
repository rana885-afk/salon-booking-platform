const express = require('express');
const pool = require('./db');
const { sendEmail } = require('./emailSender');
const { verifyToken } = require('./middleware');
const router = express.Router();

// GET /notifications/preferences (userId comes from the token)
router.get('/preferences', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const result = await pool.query(
      'SELECT user_id, email_enabled, reminders_enabled FROM notification_preferences WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      return res.json({ user_id: userId, email_enabled: true, reminders_enabled: true });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /notifications/preferences (userId comes from the token)
router.put('/preferences', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  const { email_enabled, reminders_enabled } = req.body;
  if (typeof email_enabled !== 'boolean' || typeof reminders_enabled !== 'boolean') {
    return res.status(400).json({ error: 'email_enabled and reminders_enabled are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO notification_preferences (user_id, email_enabled, reminders_enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id)
       DO UPDATE SET email_enabled = $2, reminders_enabled = $3
       RETURNING user_id, email_enabled, reminders_enabled`,
      [userId, email_enabled, reminders_enabled]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /notifications/email  (called by the Booking service)
router.post('/email', async (req, res) => {
  const { userId, appointmentId, type, email } = req.body;
  if (!userId || !appointmentId || !email || !['confirmation', 'cancellation', 'reschedule'].includes(type)) {
    return res.status(400).json({ error: 'userId, appointmentId, email and a valid type are required' });
  }

  let notification;
  try {
    const prefs = await pool.query(
      'SELECT email_enabled FROM notification_preferences WHERE user_id = $1',
      [userId]
    );
    if (prefs.rows.length > 0 && !prefs.rows[0].email_enabled) {
      return res.status(202).json({ message: 'User disabled email notifications, nothing sent' });
    }
    const inserted = await pool.query(
      `INSERT INTO notifications (user_id, appointment_id, type, scheduled_time, recipient_email)
       VALUES ($1, $2, $3, NOW(), $4)
       RETURNING *`,
      [userId, appointmentId, type, email]
    );
    notification = inserted.rows[0];
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }

  const subjects = {
  confirmation: 'Your appointment is confirmed',
  cancellation: 'Your appointment was cancelled',
  reschedule: 'Your appointment was rescheduled'
};
const subject = subjects[type];
  const html = `<p>${subject}. Appointment number: ${notification.appointment_id}.</p>`;

  try {
    await sendEmail(email, subject, html);
    const updated = await pool.query(
      `UPDATE notifications SET status = 'sent', sent_at = NOW() WHERE id = $1 RETURNING *`,
      [notification.id]
    );
    return res.status(202).json(updated.rows[0]);
  } catch (err) {
    console.error(err.message);
    const failed = await pool.query(
      `UPDATE notifications SET status = 'failed', retry_count = retry_count + 1 WHERE id = $1 RETURNING *`,
      [notification.id]
    );
    return res.status(502).json({ error: 'Email provider failed', notification: failed.rows[0] });
  }
});

// POST /notifications/reminders  (called by the Booking service)
router.post('/reminders', async (req, res) => {
  const { userId, appointmentId, email, appointmentTime } = req.body;
  const time = new Date(appointmentTime);
  if (!userId || !appointmentId || !email || isNaN(time.getTime())) {
    return res.status(400).json({ error: 'userId, appointmentId, email and a valid appointmentTime are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO notifications (user_id, appointment_id, type, scheduled_time, recipient_email)
       VALUES ($1, $2, 'reminder', $3::timestamptz - INTERVAL '24 hours', $4)
       RETURNING *`,
      [userId, appointmentId, time.toISOString(), email]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /notifications/history (userId comes from the token)
router.get('/history', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const result = await pool.query(
      `SELECT id, appointment_id, type, channel, status, scheduled_time, sent_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY scheduled_time DESC
       LIMIT 50`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;