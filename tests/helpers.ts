import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { pool } from "../src/db/pool.js";
import { env } from "../src/config/env.js";

export function createTestToken(userId: string, role: "customer" | "organizer") {
  return jwt.sign({ role }, env.JWT_SECRET, {
    subject: userId,
    expiresIn: "1h",
  });
}

export async function createTestUser(email: string, role: "customer" | "organizer" = "customer") {
  const hash = await bcrypt.hash("Password123!", 10);
  const result = await pool.query<{ id: string; email: string; role: string }>(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (LOWER(email)) DO UPDATE SET role = EXCLUDED.role
     RETURNING id, email, role`,
    [email.toLowerCase(), hash, role]
  );
  const user = result.rows[0];
  const token = createTestToken(user.id, role);
  return { user, token };
}

export async function createTestEvent(organizerId: string, options: {
  title?: string;
  capacity?: number;
  availableTickets?: number;
  startsAt?: Date;
  status?: "published" | "cancelled" | "completed";
} = {}) {
  const title = options.title || `Test Event ${Date.now()}`;
  const capacity = options.capacity ?? 20;
  const availableTickets = options.availableTickets ?? capacity;
  const startsAt = options.startsAt || new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days in future
  const status = options.status || "published";

  const result = await pool.query(
    `INSERT INTO events (organizer_id, title, description, venue, starts_at, capacity, available_tickets, status)
     VALUES ($1, $2, 'A test event description', 'Test Grand Arena', $3, $4, $5, $6)
     RETURNING *`,
    [organizerId, title, startsAt, capacity, availableTickets, status]
  );

  return result.rows[0];
}