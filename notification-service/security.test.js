require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('./server');
const pool = require('./db');

const validToken = jwt.sign(
  { userId: 1, email: 'rana222400@bue.edu.eg', role: 'customer' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

afterAll(async () => {
  await pool.end();
});

describe('Security: authentication', () => {
  test('no token -> 401', async () => {
    const res = await request(app).get('/notifications/preferences');
    expect(res.status).toBe(401);
  });

  test('tampered token -> 401', async () => {
    const res = await request(app)
      .get('/notifications/preferences')
      .set('Authorization', `Bearer ${validToken}x`);
    expect(res.status).toBe(401);
  });

  test('token signed with a wrong secret -> 401', async () => {
    const fake = jwt.sign({ userId: 1, role: 'customer' }, 'wrong-secret');
    const res = await request(app)
      .get('/notifications/history')
      .set('Authorization', `Bearer ${fake}`);
    expect(res.status).toBe(401);
  });

  test('valid token -> 200', async () => {
    const res = await request(app)
      .get('/notifications/preferences')
      .set('Authorization', `Bearer ${validToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(1);
  });
});

describe('Security: user cannot read another user data', () => {
  test('userId in the query string is ignored (token wins)', async () => {
    const res = await request(app)
      .get('/notifications/preferences?userId=999')
      .set('Authorization', `Bearer ${validToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(1);
  });
});

describe('Security: SQL injection', () => {
  test('malicious email in /email does not break the database', async () => {
    const res = await request(app)
      .post('/notifications/email')
      .send({
        userId: 1,
        appointmentId: 10,
        type: 'confirmation',
        email: "x'; DROP TABLE notifications; --"
      });
    expect([202, 400, 502]).toContain(res.status);

    const check = await pool.query('SELECT COUNT(*) FROM notifications');
    expect(Number(check.rows[0].count)).toBeGreaterThanOrEqual(0);
  });
});

describe('Security: wrong role (403)', () => {
  test('requireRole rejects a customer token', async () => {
    const express = require('express');
    const { verifyToken, requireRole } = require('./middleware');
    const mini = express();
    mini.get('/owner', verifyToken, requireRole('owner'), (req, res) => res.json({ ok: true }));

    const res = await request(mini)
      .get('/owner')
      .set('Authorization', `Bearer ${validToken}`);
    expect(res.status).toBe(403);
  });
});