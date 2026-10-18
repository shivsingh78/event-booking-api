import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { pool } from "../../src/db/pool.js";
import { createToken } from "../../src/routes/auth.routes.js";

async function main() {
  console.log("Setting up benchmark test data...");

  // 1. Create or get benchmark organizer
  const passwordHash = await bcrypt.hash("BenchmarkPass123!", 10);
  const orgResult = await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ('bench_organizer@example.com', $1, 'organizer')
     ON CONFLICT (LOWER(email)) DO UPDATE SET role = 'organizer'
     RETURNING id, email, role`,
    [passwordHash]
  );
  const organizer = orgResult.rows[0];
  const organizerToken = createToken(organizer);

  // 2. Create pool of 50 benchmark customers
  const customers: Array<{ id: string; email: string; token: string }> = [];
  for (let i = 0; i < 50; i++) {
    const email = `bench_customer_${i}@example.com`;
    const res = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'customer')
       ON CONFLICT (LOWER(email)) DO UPDATE SET role = 'customer'
       RETURNING id, email, role`,
      [email, passwordHash]
    );
    const user = res.rows[0];
    customers.push({
      id: user.id,
      email: user.email,
      token: createToken(user),
    });
  }

  // 3. Create high-capacity event (100,000 tickets)
  const futureDate = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const highCapResult = await pool.query(
    `INSERT INTO events (organizer_id, title, description, venue, starts_at, capacity, available_tickets, status)
     VALUES ($1, 'High Capacity Mega Concert', 'Benchmark Concert', 'National Stadium', $2, 100000, 100000, 'published')
     RETURNING id`,
    [organizer.id, futureDate]
  );
  const highCapacityEventId = highCapResult.rows[0].id;

  // 4. Create limited-inventory event (50 tickets for contention test)
  const limitedResult = await pool.query(
    `INSERT INTO events (organizer_id, title, description, venue, starts_at, capacity, available_tickets, status)
     VALUES ($1, 'Exclusive VIP Masterclass', 'VIP Masterclass', 'Skyline Lounge', $2, 50, 50, 'published')
     RETURNING id`,
    [organizer.id, futureDate]
  );
  const limitedEventId = limitedResult.rows[0].id;

  // 5. Create event update target
  const updateResult = await pool.query(
    `INSERT INTO events (organizer_id, title, description, venue, starts_at, capacity, available_tickets, status)
     VALUES ($1, 'Updatable Keynote 2026', 'Keynote', 'Main Auditorium', $2, 1000, 1000, 'published')
     RETURNING id`,
    [organizer.id, futureDate]
  );
  const updateEventId = updateResult.rows[0].id;

  const benchmarkData = {
    baseUrl: "http://localhost:3000",
    organizerToken,
    organizerId: organizer.id,
    highCapacityEventId,
    limitedEventId,
    updateEventId,
    customers,
  };

  await fs.writeFile(
    path.resolve(process.cwd(), "scripts/load/benchmark-env.json"),
    JSON.stringify(benchmarkData, null, 2)
  );

  console.log("Benchmark test data successfully prepared and saved to scripts/load/benchmark-env.json");
  await pool.end();
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});