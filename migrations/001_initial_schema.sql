CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('customer', 'organizer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Emails are case-insensitive for uniqueness.
CREATE UNIQUE INDEX users_email_lower_unique
  ON users (LOWER(email));

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id UUID NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  title VARCHAR(200) NOT NULL
    CHECK (LENGTH(TRIM(title)) > 0),
  description TEXT,
  venue VARCHAR(300) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL
    CHECK (capacity > 0),
  available_tickets INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT events_available_tickets_valid
    CHECK (
      available_tickets >= 0
      AND available_tickets <= capacity
    )
);

CREATE INDEX events_status_starts_at_idx
  ON events (status, starts_at);

CREATE INDEX events_organizer_id_idx
  ON events (organizer_id);

CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  event_id UUID NOT NULL
    REFERENCES events(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL
    CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled')),
  idempotency_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bookings_customer_idempotency_unique
    UNIQUE (customer_id, idempotency_key)
);

CREATE INDEX bookings_customer_created_at_idx
  ON bookings (customer_id, created_at DESC);

CREATE INDEX bookings_event_status_idx
  ON bookings (event_id, status);
  