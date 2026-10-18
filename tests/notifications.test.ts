import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { createTestUser, createTestEvent } from "./helpers.js";

describe("Transactional Outbox & Notifications", () => {
  let customerToken: string;
  let customerId: string;
  let customerEmail: string;
  let organizerToken: string;
  let organizerId: string;

  beforeAll(async () => {
    customerEmail = `notif_cust_${Date.now()}@test.com`;
    const cust = await createTestUser(customerEmail, "customer");
    customerToken = cust.token;
    customerId = cust.user.id;

    const org = await createTestUser(`notif_org_${Date.now()}@test.com`, "organizer");
    organizerToken = org.token;
    organizerId = org.user.id;
  });

  it("records an outbox notification when a booking succeeds", async () => {
    const event = await createTestEvent(organizerId, { capacity: 10, availableTickets: 10 });

    const bookingRes = await request(app)
      .post(`/api/events/${event.id}/bookings`)
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", `notif_book_${Date.now()}`)
      .send({ quantity: 2 });

    expect(bookingRes.status).toBe(201);
    const bookingId = bookingRes.body.booking.id;

    // Check outbox table for this booking
    const outboxRecord = await pool.query(
      `SELECT * FROM outbox_notifications
       WHERE aggregate_type = 'booking' AND aggregate_id = $1`,
      [bookingId]
    );

    expect(outboxRecord.rowCount).toBe(1);
    const row = outboxRecord.rows[0];
    expect(row.event_type).toBe("booking_confirmation");
    expect(row.payload.customerEmail).toBe(customerEmail.toLowerCase());
    expect(row.payload.bookingId).toBe(bookingId);
    expect(row.payload.quantity).toBe(2);
  });

  it("records an event_updated outbox notification when organizer modifies event details", async () => {
    const event = await createTestEvent(organizerId, { capacity: 20, availableTickets: 20 });

    // Customer books a ticket first
    await request(app)
      .post(`/api/events/${event.id}/bookings`)
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", `notif_book_for_upd_${Date.now()}`)
      .send({ quantity: 1 });

    // Organizer updates the event title and venue
    const updateRes = await request(app)
      .patch(`/api/events/${event.id}`)
      .set("Authorization", `Bearer ${organizerToken}`)
      .send({
        title: "Updated Grand Symphony",
        venue: "New Grand Auditorium",
      });

    expect(updateRes.status).toBe(200);

    // Check outbox table for event_updated notification
    const outboxRecord = await pool.query(
      `SELECT * FROM outbox_notifications
       WHERE aggregate_type = 'event' AND aggregate_id = $1 AND event_type = 'event_updated'
       ORDER BY created_at DESC LIMIT 1`,
      [event.id]
    );

    expect(outboxRecord.rowCount).toBe(1);
    const row = outboxRecord.rows[0];
    expect(row.payload.newTitle).toBe("Updated Grand Symphony");
    expect(row.payload.venue).toBe("New Grand Auditorium");
    expect(row.payload.recipients.some((r: any) => r.email === customerEmail.toLowerCase())).toBe(true);
  });

  it("does not create an outbox notification when an update is rejected", async () => {
    const event = await createTestEvent(organizerId, { capacity: 20, availableTickets: 20 });
    const wrongOrg = await createTestUser(`wrong_org_${Date.now()}@test.com`, "organizer");

    const outboxBefore = await pool.query(
      "SELECT COUNT(*) FROM outbox_notifications WHERE aggregate_id = $1",
      [event.id]
    );

    const updateRes = await request(app)
      .patch(`/api/events/${event.id}`)
      .set("Authorization", `Bearer ${wrongOrg.token}`)
      .send({ title: "Unauthorized Change" });

    expect(updateRes.status).toBe(403);

    const outboxAfter = await pool.query(
      "SELECT COUNT(*) FROM outbox_notifications WHERE aggregate_id = $1",
      [event.id]
    );

    expect(outboxAfter.rows[0].count).toBe(outboxBefore.rows[0].count);
  });
});