require('dotenv').config();
const express = require('express');
const auth = require('./middleware/auth');
const svc = require('./services/paymentService');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/payments', auth, async (req, res, next) => {
  try {
    const p = await svc.createPayment({
      appointmentId: req.body.appointment_id,
      amount: req.body.amount,
      userId: req.user.id,
      authHeader: req.headers.authorization,
    });
    res.status(201).json(p);
  } catch (e) { next(e); }
});

app.get('/payments', auth, async (req, res, next) => {
  try { res.json(await svc.listPayments(req.user.id)); } catch (e) { next(e); }
});

app.get('/payments/:id', auth, async (req, res, next) => {
  try { res.json(await svc.getPayment(Number(req.params.id), req.user.id)); } catch (e) { next(e); }
});

app.post('/payments/:id/refund', auth, async (req, res, next) => {
  try { res.json(await svc.refundPayment(Number(req.params.id), req.user.id)); } catch (e) { next(e); }
});

app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
 res.status(err.status || 500).json({ error: err.message });
});

app.listen(process.env.PORT || 3005, () => console.log('Payment service on port', process.env.PORT || 3005));