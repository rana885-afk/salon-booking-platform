const Stripe = require('stripe');
const db = require('../db');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const fail = (status, message) => Object.assign(new Error(message), { status });

async function getAppointment(id, authHeader) {
  const r = await fetch(`${process.env.BOOKING_URL}/appointments/${id}`, {
    headers: { Authorization: authHeader },
  });
  if (r.status === 404) throw fail(404, 'Appointment not found');
  if (!r.ok) throw fail(502, 'Booking service error');
  return r.json();
}

async function setAppointmentStatus(id, status, authHeader) {
  try {
    const r = await fetch(`${process.env.BOOKING_URL}/appointments/${id}/payment-status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) console.error('Could not set appointment status:', r.status);
  } catch (e) {
    console.error('Could not reach booking service:', e.message);
  }
}

async function createPayment({ appointmentId, amount, userId, authHeader }) {
  if (!Number.isInteger(appointmentId) || appointmentId <= 0)
    throw fail(400, 'appointment_id must be a positive integer');
  if (typeof amount !== 'number' || amount <= 0 || amount > 100000)
    throw fail(400, 'amount must be a number between 0 and 100000');

  const appt = await getAppointment(appointmentId, authHeader);
  if (['cancelled', 'completed'].includes(appt.status))
    throw fail(409, `Cannot pay for a ${appt.status} appointment`);

  const paid = await db.query(
    "SELECT id FROM payment.payments WHERE appointment_id=$1 AND status='succeeded'",
    [appointmentId]
  );
  if (paid.rows.length) throw fail(409, 'Appointment is already paid');

  // Stripe test mode: pm_card_visa is a built-in fake card
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: 'usd',
    payment_method: 'pm_card_visa',
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
  });

  const { rows } = await db.query(
    `INSERT INTO payment.payments (appointment_id, user_id, amount, stripe_payment_intent_id, status)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [appointmentId, userId, amount, intent.id, intent.status]
  );

  if (rows[0].status === 'succeeded') {
    await setAppointmentStatus(appointmentId, 'confirmed', authHeader);
  }
  return rows[0];
}

async function getPayment(id, userId) {
  const { rows } = await db.query('SELECT * FROM payment.payments WHERE id=$1', [id]);
  if (!rows.length) throw fail(404, 'Payment not found');
  if (String(rows[0].user_id) !== String(userId)) throw fail(403, 'Not your payment');
  return rows[0];
}

async function listPayments(userId) {
  const { rows } = await db.query(
    'SELECT * FROM payment.payments WHERE user_id=$1 ORDER BY id DESC', [userId]);
  return rows;
}

async function refundPayment(id, userId, authHeader) {
  const p = await getPayment(id, userId);
  if (p.status !== 'succeeded') throw fail(409, `Cannot refund a ${p.status} payment`);
  await stripe.refunds.create({ payment_intent: p.stripe_payment_intent_id });
  const { rows } = await db.query(
    "UPDATE payment.payments SET status='refunded' WHERE id=$1 RETURNING *", [id]);
  await setAppointmentStatus(p.appointment_id, 'cancelled', authHeader);
  return rows[0];
}

module.exports = { createPayment, getPayment, listPayments, refundPayment };