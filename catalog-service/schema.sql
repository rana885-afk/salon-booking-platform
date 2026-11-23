CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE catalog.salons (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  name VARCHAR(100) NOT NULL,
  address VARCHAR(255) NOT NULL,
  city VARCHAR(100) NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  average_rating NUMERIC(2,1) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE catalog.services (
  id SERIAL PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES catalog.salons(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  price NUMERIC(8,2) NOT NULL CHECK (price >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0)
);

CREATE TABLE catalog.stylists (
  id SERIAL PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES catalog.salons(id) ON DELETE CASCADE,
  user_id INTEGER,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE catalog.working_hours (
  id SERIAL PRIMARY KEY,
  stylist_id INTEGER NOT NULL REFERENCES catalog.stylists(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  UNIQUE (stylist_id, weekday)
);

CREATE TABLE catalog.time_off (
  id SERIAL PRIMARY KEY,
  stylist_id INTEGER NOT NULL REFERENCES catalog.stylists(id) ON DELETE CASCADE,
  from_time TIMESTAMPTZ NOT NULL,
  to_time TIMESTAMPTZ NOT NULL
);

CREATE TABLE catalog.reviews (
  id SERIAL PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES catalog.salons(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL,
  appointment_id INTEGER NOT NULL UNIQUE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);