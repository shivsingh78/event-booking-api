-- Migration 002: Transactional Outbox for notifications
CREATE TABLE IF NOT EXISTS outbox_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS outbox_status_created_idx
  ON outbox_notifications (status, created_at ASC);

CREATE INDEX IF NOT EXISTS outbox_aggregate_idx
  ON outbox_notifications (aggregate_type, aggregate_id);