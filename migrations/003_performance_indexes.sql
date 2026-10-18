-- Migration 003: Performance Optimization Indexes
CREATE INDEX IF NOT EXISTS events_booking_lookup_idx
  ON events (id, status, starts_at, available_tickets);

CREATE INDEX IF NOT EXISTS events_organizer_created_idx
  ON events (organizer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS users_id_email_idx
  ON users (id, email);