import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { createTestUser, createTestEvent } from "./helpers.js";

describe("Concurrency & Inventory Protection", () => {
  let organizerId: string;
  let customers: Array<{ id: string; token: string }>;

  beforeAll(async () => {
    const org = await createTestUser(`conc_org_${Date.now()}@test.com`, "organizer");
    organizerId = org.user.id;

    // Create 40 distinct customers for concurrent tests
    customers = [];
    for (let i = 0; i < 40; i++) {
      const cust = await createTestUser(`conc_cust_${i}_${Date.now()}@test.com`, "customer");
      customers.push({ id: cust.user.id, token: cust.token });
    }
  });

  it("prevents overselling when 40 concurrent requests contend for only 10 tickets", async () => {
    const event = await createTestEvent(organizerId, { capacity: 10, availableTickets: 10 });

    // Send 40 simultaneous requests (1 ticket each)
    const promises = customers.map((customer, index) =>
      request(app)
        .post(`/api/events/${event.id}/bookings`)
        .set("Authorization", `Bearer ${customer.token}`)
        .set("Idempotency-Key", `conc_key_${index}_${Date.now()}`)
        .send({ quantity: 1 })
    );

    const results = await Promise.all(promises);

    const successful = results.filter((r) => r.status === 201);
    const soldOut = results.filter((r) => r.status === 409);

    console.log(`Concurrency Test Results: Success=${successful.length}, SoldOut=${soldOut.length}`);

    // Exactly 10 must succeed
    expect(successful.length).toBe(10);
    // Exactly 30 must be rejected with 409
    expect(soldOut.length).toBe(30);

    // Verify database state directly
    const eventInDb = await pool.query("SELECT available_tickets, capacity FROM events WHERE id = $1", [event.id]);
    expect(eventInDb.rows[0].available_tickets).toBe(0);
    expect(eventInDb.rows[0].capacity).toBe(10);

    // Verify exact total bookings in database
    const totalBookings = await pool.query(
      "SELECT COUNT(*) AS total, SUM(quantity) AS tickets_sold FROM bookings WHERE event_id = $1",
      [event.id]
    );
    expect(Number(totalBookings.rows[0].total)).toBe(10);
    expect(Number(totalBookings.rows[0].tickets_sold)).toBe(10);
  });

  it("handles simultaneous duplicate requests with identical idempotency key safely", async () => {
    const event = await createTestEvent(organizerId, { capacity: 20, availableTickets: 20 });
    const sharedKey = `shared_idem_${Date.now()}`;
    const singleCustomer = customers[0];

    // Fire 15 concurrent identical requests from the same customer with the same key
    const duplicatePromises = Array.from({ length: 15 }).map(() =>
      request(app)
        .post(`/api/events/${event.id}/bookings`)
        .set("Authorization", `Bearer ${singleCustomer.token}`)
        .set("Idempotency-Key", sharedKey)
        .send({ quantity: 2 })
    );

    const responses = await Promise.all(duplicatePromises);

    // Every response must be either 201 (initial) or 200 (idempotent replay)
    const validCodes = responses.filter((r) => r.status === 200 || r.status === 201);
    expect(validCodes.length).toBe(15);

    // All must return the exact same booking ID
    const bookingIds = new Set(responses.map((r) => r.body.booking.id));
    expect(bookingIds.size).toBe(1);

    // Verify inventory only deducted by 2 (20 - 2 = 18)
    const checkDb = await pool.query("SELECT available_tickets FROM events WHERE id = $1", [event.id]);
    expect(checkDb.rows[0].available_tickets).toBe(18);

    // Verify exactly 1 booking row exists in DB
    const dbBookings = await pool.query("SELECT COUNT(*) AS count FROM bookings WHERE event_id = $1", [event.id]);
    expect(Number(dbBookings.rows[0].count)).toBe(1);
  });
});