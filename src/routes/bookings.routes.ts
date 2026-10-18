import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { bookingRateLimiter } from "../middleware/rateLimit.js";
import { notificationQueue } from "../jobs/queue.js";

const router = Router();

const createBookingSchema = z.object({
  quantity: z.coerce.number().int().positive().max(100),
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
});

// Customer: list own bookings
router.get(
  "/me",
  authenticate,
  requireRole("customer"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           b.id,
           b.customer_id,
           b.event_id,
           b.quantity,
           b.status,
           b.idempotency_key,
           b.created_at,
           e.title AS event_title,
           e.venue AS event_venue,
           e.starts_at AS event_starts_at
         FROM bookings b
         JOIN events e ON b.event_id = e.id
         WHERE b.customer_id = $1
         ORDER BY b.created_at DESC`,
        [req.auth!.userId]
      );

      return res.json({ data: result.rows });
    } catch (error) {
      console.error("List customer bookings failed", error);
      return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
    }
  }
);

export default router;