import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { createTestUser, createTestEvent } from "./helpers.js";

describe("Bookings API & Idempotency", () => {
  let customerToken: string;
  let customerId: string;
  let otherCustomerToken: string;
  let organizerToken: string;
  let organizerId: string;

  beforeAll(async () => {
    const cust1 = await createTestUser(`book_cust1_${Date.now()}@test.com`, "customer");
    customerToken = cust1.token;
    customerId = cust1.user.id;

    const cust2 = await createTestUser(`book_cust2_${Date.now()}@test.com`, "customer");
    otherCustomerToken = cust2.token;

    const org = await createTestUser(`book_org_${Date.now()}@test.com`, "organizer");
    organizerToken = org.token;
    organizerId = org.user.id;
  });

  it("Customer books tickets with sufficient inventory and idempotency key", async () => {
    const event = await createTestEvent(organizerId, { capacity: 20, availableTickets: 20 });
    const idempotencyKey = `idem_${Date.now()}`;

    const res = await request(app)
      .post(`/api/events/${event.id}/bookings`)
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body.booking).toBeDefined();
    expect(res.body.booking.quantity).toBe(2);
    expect(res.body.remainingTickets).toBe(18);

    // Verify DB inventory is updated
    const checkDb = await pool.query("SELECT available_tickets FROM events WHERE id = $1", [event.id]);
    expect(checkDb.rows[0].available_tickets).toBe(18);
  });

  it("Idempotent retry with identical payload returns original booking", async () => {
    const event = await createTestEvent(organizerId, { capacity: 20, availableTickets: 20 });
    const idempotencyKey = `idem_retry_${Date.now()}`;

    // First request
    const res1 = await request(app)
      .post(`/api/events/${event.id}/bookings`)
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ quantity: 3 });

    expect(res1.status).toBe(201);
    const bookingId = res1.body.booking.id;

    // Retry request with same key and payload
    const res2 = await request(app)
      .post(`/api/events/${event.id}/bookings`)
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ quantity: 3 });

    expect(res2.status).toBe(200);
    expect(res2.body.booking.id).toBe(bookingId);
    expect(res2.body.idempotentReplay).toBe(true);

    // Verify inventory was only decremented ONCE (20 - 3 = 17)
    const checkDb = await pool.query("SELECT available_tickets FROM events WHERE id = $1", [event.id]);
    expect(checkDb.rows[0].available_tickets).toBe(17);
  });

  it("Reusing same idempotency key with different payload is rejected", async () => {
    const event = await createTestEvent(organizerId, { capacity: 20, availableTickets: 20 });
    const idempotencyKey = `idem_conflict_${Date.now()}`;

    // Initial request for 2 tickets
    await request(app)
      .post(`/api/events/${event.id}/bookings`)
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ quantity: 2 });

    // Request with same key but requesting 4 tickets
    const conflictRes = await request(app)
      .post(`/api/events/${event.id}/bookings`)
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ quantity: 4 });

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error).toBe("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
  });

  it("Booking fails with 409 when insufficient tickets remain", async () => {
    const event = await createTestEvent(organizerId, { capacity: 5, availableTickets: 2 });

    const res = await request(app)
      .post(`/api/events/${event.id}/bookings`)
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", `idem_fail_${Date.now()}`)
      .send({ quantity: 5 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("INSUFFICIENT_INVENTORY");
    expect(res.body.availableTickets).toBe(2);
  });

  it("GET /api/bookings/me returns customer's own bookings", async () => {
    const res = await request(app)
      .get("/api/bookings/me")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((b: any) => b.customer_id === customerId)).toBe(true);
  });

  it("GET /api/events/:id/bookings allows organizer to see bookings for their event", async () => {
    const event = await createTestEvent(organizerId, { capacity: 10, availableTickets: 10 });
    await request(app)
      .post(`/api/events/${event.id}/bookings`)
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", `idem_org_view_${Date.now()}`)
      .send({ quantity: 2 });

    const res = await request(app)
      .get(`/api/events/${event.id}/bookings`)
      .set("Authorization", `Bearer ${organizerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].quantity).toBe(2);
  });
});