const cron = require('node-cron');
const pool = require('./db');
const { sendEmail } = require('./emailSender');

const MAX_RETRIES = 3;
let running = false;

const SUBJECTS = {
  confirmation: 'Your appointment is confirmed',
  cancellation: 'Your appointment was cancelled',
  reschedule: 'Your appointment was rescheduled',
};

function buildMessage(n) {
  if (n.type === 'reminder') {
    return {
      subject: 'Reminder: your appointment is tomorrow',
      html: `<p>This is a reminder for your appointment number ${n.appointment_id}.</p>`,
    };
  }
  const subject = SUBJECTS[n.type];
  return { subject, html: `<p>${subject}. Appointment number: ${n.appointment_id}.</p>` };
}

async function processDueNotifications() {
  const due = await pool.query(
    `SELECT n.*,
            COALESCE(p.email_enabled, true) AS email_enabled,
            COALESCE(p.reminders_enabled, true) AS reminders_enabled
     FROM notifications n
     LEFT JOIN notification_preferences p ON p.user_id = n.user_id
     WHERE n.status IN ('pending', 'failed')
       AND n.retry_count < $1
       AND n.scheduled_time <= NOW()
     ORDER BY n.scheduled_time
     LIMIT 20`,
    [MAX_RETRIES]
  );

  for (const n of due.rows) {
    // The user turned this kind of notification off
    if (!n.email_enabled || (n.type === 'reminder' && !n.reminders_enabled)) {
      await pool.query(`UPDATE notifications SET status = 'skipped' WHERE id = $1`, [n.id]);
      continue;
    }

    // The appointment was cancelled, or a newer reminder exists (it was rescheduled)
    if (n.type === 'reminder') {
      const replaced = await pool.query(
        `SELECT 1 FROM notifications
         WHERE appointment_id = $1
           AND (type = 'cancellation' OR (type = 'reminder' AND id > $2))
         LIMIT 1`,
        [n.appointment_id, n.id]
      );
      if (replaced.rows.length > 0) {
        await pool.query(`UPDATE notifications SET status = 'skipped' WHERE id = $1`, [n.id]);
        continue;
      }
    }

    const { subject, html } = buildMessage(n);
    try {
      await sendEmail(n.recipient_email, subject, html);
      await pool.query(`UPDATE notifications SET status = 'sent', sent_at = NOW() WHERE id = $1`, [n.id]);
      console.log(`Notification ${n.id} sent`);
    } catch (err) {
      console.error(`Notification ${n.id} failed: ${err.message}`);
      await pool.query(
        `UPDATE notifications SET status = 'failed', retry_count = retry_count + 1 WHERE id = $1`,
        [n.id]
      );
    }
  }
}

function startScheduler() {
  cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      await processDueNotifications();
    } catch (err) {
      console.error('Scheduler error:', err.message);
    } finally {
      running = false;
    }
  });
  console.log('Scheduler started (runs every minute)');
}

module.exports = { startScheduler };