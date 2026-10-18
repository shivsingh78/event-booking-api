# Event Booking API

A role-based event booking backend with concurrent-safe ticket
inventory and asynchronous email notifications.

## Technology Stack

- Node.js, Express and TypeScript
- PostgreSQL for persistent data and booking consistency
- Redis and BullMQ for background jobs
- Resend for real email delivery
- Zod for request and environment validation
- k6 for load testing

## Architecture

The API handles authentication, authorization, event management
and booking requests. PostgreSQL is the source of truth for ticket
inventory. A separate worker processes email jobs asynchronously.

## Initial Design Decisions

### 1. PostgreSQL owns ticket inventory

Ticket inventory must not be maintained only in application memory
or Redis. The booking service will conditionally decrement available
tickets and create the booking in the same database transaction.

This prevents overselling when multiple API instances handle
concurrent requests.

### 2. Idempotent bookings

Each booking request will require an idempotency key. A database
unique constraint prevents the same customer and key from creating
multiple bookings. Reusing a key with a different request payload
will be rejected by the service.

### 3. Role-based access control

Customers can browse events and manage their own bookings.
Organizers can manage only events they own.

Public registration will create customer accounts only. Organizer
accounts must be provisioned through an authorized mechanism.

### 4. Asynchronous notifications

Booking confirmations and event-update notifications will be sent
through a background queue and a separate worker. Email delivery
will not block the main booking API response.

Jobs must be retried safely, and notification failures must be
observable. Queue reliability and duplicate-delivery handling will
be documented as the implementation evolves.

### 5. Performance evaluation

The initial implementation and optimized implementation will be
tested at comparable concurrency levels using k6.

Results will record throughput, latency percentiles, HTTP failures,
and booking correctness. Sold-out responses are expected business
outcomes and must be distinguished from infrastructure failures.

## Data Model

- User has many bookings.
- Organizer owns many events.
- Event has many bookings.
- Booking belongs to one customer and one event.

## Local Development

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL and Redis with `docker compose up -d`.
3. Apply SQL migrations.
4. Run `pnpm dev`.

## Load Test Results

To be completed with measured baseline and optimized results.

## Deployment

To be completed with actual deployed URLs, configuration steps,
and verified smoke-test results.

## Known Limitations

This README will be updated as transactional guarantees,
notification reliability, testing, and deployment are implemented.