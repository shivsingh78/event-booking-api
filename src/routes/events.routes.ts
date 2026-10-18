import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { bookingRateLimiter } from "../middleware/rateLimit.js";
import { notificationQueue } from "../jobs/queue.js";

const router = Router();

const futureDate = z
  .string()
  .datetime()
  .refine(
    (value) => new Date(value).getTime() > Date.now(),
    "The event must start in the future",
  );

const createEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  venue: z.string().trim().min(1).max(300),
  startsAt: futureDate,
  capacity: z.number().int().positive().max(1_000_000),
});

const updateEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    venue: z.string().trim().min(1).max(300).optional(),
    startsAt: futureDate.optional(),
    status: z.enum(["published", "cancelled", "completed"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});

const createBookingSchema = z.object({
  quantity: z.coerce.number().int().positive().max(100),
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
});

const eventColumns = `
  id, organizer_id, title, description, venue, starts_at,
  capacity, available_tickets, status, created_at, updated_at
`;

// Public: browse future published events.
router.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      details: parsed.error.flatten(),
    });
  }

  const { page, limit, search } = parsed.data;
  const searchTerm = search || null;
  const offset = (page - 1) * limit;

  try {
    const [eventsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT ${eventColumns}
         FROM events
         WHERE status = 'published'
           AND starts_at > NOW()
           AND ($1::text IS NULL OR title ILIKE '%' || $1 || '%')
         ORDER BY starts_at ASC
         LIMIT $2 OFFSET $3`,
        [searchTerm, limit, offset],
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM events
         WHERE status = 'published'
           AND starts_at > NOW()
           AND ($1::text IS NULL OR title ILIKE '%' || $1 || '%')`,
        [searchTerm],
      ),
    ]);

    return res.json({
      data: eventsResult.rows,
      pagination: {
        page,
        limit,
        total: Number(countResult.rows[0]?.total ?? 0),
      },
    });
  } catch (error) {
    console.error("List events failed", error);
    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});

// Organizer: list only events they own.
router.get(
  "/mine",
  authenticate,
  requireRole("organizer"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT ${eventColumns}
         FROM events
         WHERE organizer_id = $1
         ORDER BY created_at DESC`,
        [req.auth!.userId],
      );

      return res.json({ data: result.rows });
    } catch (error) {
      console.error("List organizer events failed", error);
      return res.status(500).json({
        error: "INTERNAL_SERVER_ERROR",
      });
    }
  },
);

// Organizer: create an event.
router.post(
  "/",
  authenticate,
  requireRole("organizer"),
  async (req, res) => {
    const parsed = createEventSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      });
    }

    const input = parsed.data;

    try {
      const result = await pool.query(
        `INSERT INTO events (
           organizer_id, title, description, venue, starts_at,
           capacity, available_tickets
         )
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING ${eventColumns}`,
        [
          req.auth!.userId,
          input.title,
          input.description ?? null,
          input.venue,
          new Date(input.startsAt),
          input.capacity,
        ],
      );

      return res.status(201).json({ event: result.rows[0] });
    } catch (error) {
      console.error("Create event failed", error);
      return res.status(500).json({
        error: "INTERNAL_SERVER_ERROR",
      });
    }
  },
);

// Public: view a published event.
router.get("/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);

  if (!id.success) {
    return res.status(400).json({ error: "INVALID_EVENT_ID" });
  }

  try {
    const result = await pool.query(
      `SELECT ${eventColumns}
       FROM events
       WHERE id = $1 AND status = 'published'`,
      [id.data],
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    }

    return res.json({ event: result.rows[0] });
  } catch (error) {
    console.error("Get event failed", error);
    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});

// Organizer: update only an event they own.
router.patch(
  "/:id",
  authenticate,
  requireRole("organizer"),
  async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = updateEventSchema.safeParse(req.body);

    if (!id.success) {
      return res.status(400).json({ error: "INVALID_EVENT_ID" });
    }

    if (!parsed.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      });
    }

    const input = parsed.data;
    const hasDescription = Object.hasOwn(input, "description");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingCheck = await client.query(
        `SELECT id, organizer_id, title, venue, starts_at, status
         FROM events
         WHERE id = $1`,
        [id.data]
      );

      if (existingCheck.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "EVENT_NOT_FOUND" });
      }

      const existingEvent = existingCheck.rows[0];
      if (existingEvent.organizer_id !== req.auth!.userId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "INSUFFICIENT_PERMISSIONS" });
      }

      const result = await client.query(
        `UPDATE events
         SET title = COALESCE($1::varchar, title),
             description = CASE
               WHEN $2::boolean THEN $3::text
               ELSE description
             END,
             venue = COALESCE($4::varchar, venue),
             starts_at = COALESCE($5::timestamptz, starts_at),
             status = COALESCE($6::text, status),
             updated_at = NOW()
         WHERE id = $7 AND organizer_id = $8
         RETURNING ${eventColumns}`,
        [
          input.title ?? null,
          hasDescription,
          input.description ?? null,
          input.venue ?? null,
          input.startsAt ? new Date(input.startsAt) : null,
          input.status ?? null,
          id.data,
          req.auth!.userId,
        ],
      );

      const updatedEvent = result.rows[0];

      const detailsChanged =
        (input.title && input.title !== existingEvent.title) ||
        (input.venue && input.venue !== existingEvent.venue) ||
        (input.startsAt && new Date(input.startsAt).getTime() !== new Date(existingEvent.starts_at).getTime());

      if (detailsChanged) {
        const bookedCustomers = await client.query<{ email: string; customer_id: string }>(
          `SELECT DISTINCT u.email, u.id AS customer_id
           FROM bookings b
           JOIN users u ON b.customer_id = u.id
           WHERE b.event_id = $1 AND b.status = 'confirmed'`,
          [id.data]
        );

        if (bookedCustomers.rows.length > 0) {
          const outboxPayload = {
            eventId: id.data,
            oldTitle: existingEvent.title,
            newTitle: updatedEvent.title,
            venue: updatedEvent.venue,
            startsAt: updatedEvent.starts_at,
            changeSummary: `Updated details on ${new Date().toISOString()}`,
            recipients: bookedCustomers.rows.map((r) => ({ email: r.email, customerId: r.customer_id })),
          };

          const outboxResult = await client.query(
            `INSERT INTO outbox_notifications (
               event_type, aggregate_type, aggregate_id, payload
             )
             VALUES ('event_updated', 'event', $1, $2)
             RETURNING id`,
            [id.data, JSON.stringify(outboxPayload)]
          );

          const outboxId = outboxResult.rows[0]?.id;

          for (const recipient of bookedCustomers.rows) {
            try {
              await notificationQueue.add(
                "event_updated",
                {
                  outboxId,
                  to: recipient.email,
                  eventTitle: updatedEvent.title,
                  venue: updatedEvent.venue,
                  startsAt: updatedEvent.starts_at,
                  changeSummary: `Updated event schedule or venue`,
                },
                {
                  jobId: `event_${id.data}_${recipient.customer_id}_${Date.now()}`,
                }
              );
            } catch (queueErr) {
              console.warn("[Queue] Immediate dispatch warning:", (queueErr as Error).message);
            }
          }
        }
      }

      await client.query("COMMIT");
      return res.json({ event: updatedEvent });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Update event failed", error);
      return res.status(500).json({
        error: "INTERNAL_SERVER_ERROR",
      });
    } finally {
      client.release();
    }
  },
);

// Logical deletion
router.delete(
  "/:id",
  authenticate,
  requireRole("organizer"),
  async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      return res.status(400).json({ error: "INVALID_EVENT_ID" });
    }

    try {
      const existing = await pool.query(
        "SELECT organizer_id, status FROM events WHERE id = $1",
        [id.data]
      );

      if (!existing.rowCount) {
        return res.status(404).json({ error: "EVENT_NOT_FOUND" });
      }

      if (existing.rows[0].organizer_id !== req.auth!.userId) {
        return res.status(403).json({ error: "INSUFFICIENT_PERMISSIONS" });
      }

      const result = await pool.query(
        `UPDATE events
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1
           AND organizer_id = $2
           AND status <> 'cancelled'
         RETURNING id`,
        [id.data, req.auth!.userId],
      );

      return res.status(204).send();
    } catch (error) {
      console.error("Cancel event failed", error);
      return res.status(500).json({
        error: "INTERNAL_SERVER_ERROR",
      });
    }
  },
);

// Organizer: view bookings for their event
router.get(
  "/:id/bookings",
  authenticate,
  requireRole("organizer"),
  async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      return res.status(400).json({ error: "INVALID_EVENT_ID" });
    }

    try {
      const eventCheck = await pool.query(
        "SELECT organizer_id FROM events WHERE id = $1",
        [id.data]
      );

      if (!eventCheck.rowCount) {
        return res.status(404).json({ error: "EVENT_NOT_FOUND" });
      }

      if (eventCheck.rows[0].organizer_id !== req.auth!.userId) {
        return res.status(403).json({ error: "INSUFFICIENT_PERMISSIONS" });
      }

      const bookings = await pool.query(
        `SELECT
           b.id,
           b.customer_id,
           u.email AS customer_email,
           b.quantity,
           b.status,
           b.idempotency_key,
           b.created_at
         FROM bookings b
         JOIN users u ON b.customer_id = u.id
         WHERE b.event_id = $1
         ORDER BY b.created_at DESC`,
        [id.data]
      );

      return res.json({ data: bookings.rows });
    } catch (error) {
      console.error("Get event bookings failed", error);
      return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
    }
  }
);

// Customer: Book tickets (Concurrent-safe atomic transaction with idempotency & outbox)
router.post(
  "/:id/bookings",
  authenticate,
  requireRole("customer"),
  bookingRateLimiter,
  async (req, res) => {
    const eventIdParam = z.string().uuid().safeParse(req.params.id);

    if (!eventIdParam.success) {
      return res.status(400).json({ error: "INVALID_EVENT_ID" });
    }

    const parsed = createBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      });
    }

    const { quantity } = parsed.data;
    const headerKey = req.header("idempotency-key") || req.header("x-idempotency-key");
    const idempotencyKey = (headerKey || parsed.data.idempotencyKey || "").trim();

    if (!idempotencyKey) {
      return res.status(400).json({
        error: "IDEMPOTENCY_KEY_REQUIRED",
        message: "An Idempotency-Key header or idempotencyKey body field is required.",
      });
    }

    const customerId = req.auth!.userId;
    // Use cached email from JWT to save an entire SQL round-trip inside transaction!
    let customerEmail = req.auth?.email;

    const eventId = eventIdParam.data;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Step 1: Idempotency check
      const existingBookingResult = await client.query(
        `SELECT b.id, b.customer_id, b.event_id, b.quantity, b.status, b.idempotency_key, b.created_at,
                e.available_tickets
         FROM bookings b
         JOIN events e ON b.event_id = e.id
         WHERE b.customer_id = $1 AND b.idempotency_key = $2`,
        [customerId, idempotencyKey]
      );

      if (existingBookingResult.rowCount && existingBookingResult.rowCount > 0) {
        const existing = existingBookingResult.rows[0];
        if (existing.event_id === eventId && existing.quantity === quantity) {
          await client.query("COMMIT");
          return res.status(200).json({
            booking: {
              id: existing.id,
              customerId: existing.customer_id,
              eventId: existing.event_id,
              quantity: existing.quantity,
              status: existing.status,
              idempotencyKey: existing.idempotency_key,
              createdAt: existing.created_at,
            },
            remainingTickets: existing.available_tickets,
            idempotentReplay: true,
          });
        } else {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
            message: "This idempotency key was previously used with different booking parameters.",
          });
        }
      }

      // Step 2: Atomic conditional inventory decrement
      const decrementResult = await client.query(
        `UPDATE events
         SET available_tickets = available_tickets - $1,
             updated_at = NOW()
         WHERE id = $2
           AND status = 'published'
           AND starts_at > NOW()
           AND available_tickets >= $1
         RETURNING id, available_tickets, title, venue, starts_at`,
        [quantity, eventId]
      );

      if (decrementResult.rowCount === 0) {
        const inspectEvent = await client.query(
          "SELECT id, status, starts_at, available_tickets FROM events WHERE id = $1",
          [eventId]
        );

        await client.query("ROLLBACK");

        if (inspectEvent.rowCount === 0) {
          return res.status(404).json({ error: "EVENT_NOT_FOUND" });
        }

        const event = inspectEvent.rows[0];
        if (event.status !== "published") {
          return res.status(409).json({
            error: "EVENT_NOT_BOOKABLE",
            message: `Event is currently ${event.status}.`,
          });
        }

        if (new Date(event.starts_at).getTime() <= Date.now()) {
          return res.status(409).json({
            error: "EVENT_ALREADY_STARTED",
            message: "Cannot book tickets for events that have already started.",
          });
        }

        return res.status(409).json({
          error: "INSUFFICIENT_INVENTORY",
          message: `Requested ${quantity} tickets, but only ${event.available_tickets} available.`,
          availableTickets: event.available_tickets,
        });
      }

      const updatedEvent = decrementResult.rows[0];

      // Step 3: Insert booking record
      const bookingInsertResult = await client.query(
        `INSERT INTO bookings (customer_id, event_id, quantity, status, idempotency_key)
         VALUES ($1, $2, $3, 'confirmed', $4)
         RETURNING id, customer_id, event_id, quantity, status, idempotency_key, created_at`,
        [customerId, eventId, quantity, idempotencyKey]
      );

      const booking = bookingInsertResult.rows[0];

      // Fallback only if email was not present in auth token
      if (!customerEmail) {
        const userResult = await client.query(
          "SELECT email FROM users WHERE id = $1",
          [customerId]
        );
        customerEmail = userResult.rows[0]?.email || "";
      }

      // Step 4: Record durable transactional outbox notification
      const outboxPayload = {
        bookingId: booking.id,
        customerId,
        customerEmail,
        eventId,
        eventTitle: updatedEvent.title,
        eventVenue: updatedEvent.venue,
        eventStartsAt: updatedEvent.starts_at,
        quantity,
      };

      const outboxResult = await client.query(
        `INSERT INTO outbox_notifications (
           event_type, aggregate_type, aggregate_id, payload
         )
         VALUES ('booking_confirmation', 'booking', $1, $2)
         RETURNING id`,
        [booking.id, JSON.stringify(outboxPayload)]
      );

      const outboxId = outboxResult.rows[0]?.id;

      // Commit the transaction
      await client.query("COMMIT");

      // Non-blocking trigger via BullMQ
      notificationQueue.add(
        "booking_confirmation",
        {
          outboxId,
          to: customerEmail,
          bookingId: booking.id,
          eventTitle: updatedEvent.title,
          venue: updatedEvent.venue,
          startsAt: updatedEvent.starts_at,
          quantity,
        },
        {
          jobId: `booking_${booking.id}`,
        }
      ).catch((queueErr) => {
        console.warn("[Queue] Immediate job enqueue failed (outbox will deliver):", queueErr.message);
      });

      return res.status(201).json({
        booking: {
          id: booking.id,
          customerId: booking.customer_id,
          eventId: booking.event_id,
          quantity: booking.quantity,
          status: booking.status,
          idempotencyKey: booking.idempotency_key,
          createdAt: booking.created_at,
        },
        remainingTickets: updatedEvent.available_tickets,
      });
    } catch (error: any) {
      await client.query("ROLLBACK");

      if (error && error.code === "23505") {
        try {
          const replayCheck = await pool.query(
            `SELECT b.id, b.customer_id, b.event_id, b.quantity, b.status, b.idempotency_key, b.created_at,
                    e.available_tickets
             FROM bookings b
             JOIN events e ON b.event_id = e.id
             WHERE b.customer_id = $1 AND b.idempotency_key = $2`,
            [customerId, idempotencyKey]
          );

          if (replayCheck.rowCount && replayCheck.rowCount > 0) {
            const row = replayCheck.rows[0];
            if (row.event_id === eventId && row.quantity === quantity) {
              return res.status(200).json({
                booking: {
                  id: row.id,
                  customerId: row.customer_id,
                  eventId: row.event_id,
                  quantity: row.quantity,
                  status: row.status,
                  idempotencyKey: row.idempotency_key,
                  createdAt: row.created_at,
                },
                remainingTickets: row.available_tickets,
                idempotentReplay: true,
              });
            } else {
              return res.status(409).json({
                error: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
              });
            }
          }
        } catch {
          // fall through
        }
      }

      console.error("Booking transaction failed", error);
      return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
    } finally {
      client.release();
    }
  }
);

export default router;