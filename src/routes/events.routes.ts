import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { authenticate, requireRole } from "../middleware/auth.js";

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
        [searchTerm,],
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
// This route must appear before "/:id".
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
// Inventory is initialized from capacity on the server.
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

    try {
      const result = await pool.query(
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

      if (!result.rowCount) {
        return res.status(404).json({ error: "EVENT_NOT_FOUND" });
      }

      return res.json({ event: result.rows[0] });
    } catch (error) {
      console.error("Update event failed", error);
      return res.status(500).json({
        error: "INTERNAL_SERVER_ERROR",
      });
    }
  },
);

// Logical deletion: cancel the event instead of deleting booking history.
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
      const result = await pool.query(
        `UPDATE events
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1
           AND organizer_id = $2
           AND status <> 'cancelled'
         RETURNING id`,
        [id.data, req.auth!.userId],
      );

      if (!result.rowCount) {
        return res.status(404).json({ error: "EVENT_NOT_FOUND" });
      }

      return res.status(204).send();
    } catch (error) {
      console.error("Cancel event failed", error);
      return res.status(500).json({
        error: "INTERNAL_SERVER_ERROR",
      });
    }
  },
);

export default router;