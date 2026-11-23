CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS booking;

CREATE TABLE booking.appointments (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  salon_id INTEGER NOT NULL,
  stylist_id INTEGER NOT NULL,
  service_id INTEGER NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  price NUMERIC(8,2) NOT NULL CHECK (price >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_time < end_time),
  CONSTRAINT no_double_booking EXCLUDE USING gist (
    stylist_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  ) WHERE (status <> 'cancelled')
);