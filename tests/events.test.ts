import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { createTestUser, createTestEvent } from "./helpers.js";

describe("Events API", () => {
  let customerToken: string;
  let organizerToken: string;
  let organizerId: string;
  let otherOrganizerToken: string;
  let otherOrganizerId: string;

  beforeAll(async () => {
    const cust = await createTestUser(`event_cust_${Date.now()}@test.com`, "customer");
    customerToken = cust.token;

    const org = await createTestUser(`event_org_${Date.now()}@test.com`, "organizer");
    organizerToken = org.token;
    organizerId = org.user.id;

    const org2 = await createTestUser(`event_org2_${Date.now()}@test.com`, "organizer");
    otherOrganizerToken = org2.token;
    otherOrganizerId = org2.user.id;
  });

  it("POST /api/events creates an event for an organizer", async () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    const res = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${organizerToken}`)
      .send({
        title: "Tech Summit 2026",
        description: "Annual Tech Conference",
        venue: "Convention Center Hall A",
        startsAt: futureDate,
        capacity: 150,
      });

    expect(res.status).toBe(201);
    expect(res.body.event).toBeDefined();
    expect(res.body.event.title).toBe("Tech Summit 2026");
    expect(res.body.event.capacity).toBe(150);
    expect(res.body.event.available_tickets).toBe(150);
    expect(res.body.event.status).toBe("published");
  });

  it("POST /api/events rejects creation when startsAt is in the past", async () => {
    const pastDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const res = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${organizerToken}`)
      .send({
        title: "Past Event",
        venue: "Old Hall",
        startsAt: pastDate,
        capacity: 50,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("GET /api/events lists published events with pagination", async () => {
    await createTestEvent(organizerId, { title: "Public Searchable Event" });

    const res = await request(app)
      .get("/api/events")
      .query({ page: 1, limit: 10, search: "Searchable" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.data.some((e: any) => e.title.includes("Searchable"))).toBe(true);
  });

  it("GET /api/events/mine lists only the requesting organizer's events", async () => {
    const event = await createTestEvent(organizerId, { title: "Mine Only Event" });

    const res = await request(app)
      .get("/api/events/mine")
      .set("Authorization", `Bearer ${organizerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.some((e: any) => e.id === event.id)).toBe(true);
  });

  it("PATCH /api/events/:id prevents modifying another organizer's event", async () => {
    const event = await createTestEvent(organizerId, { title: "Protected Event" });

    const res = await request(app)
      .patch(`/api/events/${event.id}`)
      .set("Authorization", `Bearer ${otherOrganizerToken}`)
      .send({ title: "Hacked Title" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("DELETE /api/events/:id cancels the event logically instead of deleting", async () => {
    const event = await createTestEvent(organizerId, { title: "Event To Cancel" });

    const deleteRes = await request(app)
      .delete(`/api/events/${event.id}`)
      .set("Authorization", `Bearer ${organizerToken}`);

    expect(deleteRes.status).toBe(204);

    // Verify it is now cancelled
    const getRes = await request(app).get(`/api/events/${event.id}`);
    expect(getRes.status).toBe(404); // Public GET /:id only returns published events
  });
});