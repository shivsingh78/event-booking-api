import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/db/pool.js";

describe("Health & Readiness API", () => {
  afterAll(async () => {
    // Keep pool open for other tests or gracefully idle
  });

  it("GET /health returns 200 with service info", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("event-booking-api");
  });

  it("GET /ready checks both database and redis", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.database).toBe("connected");
    expect(res.body.redis).toBe("connected");
  });

  it("GET /unknown-route returns 404 with standard error JSON", async () => {
    const res = await request(app).get("/unknown-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
  });
});