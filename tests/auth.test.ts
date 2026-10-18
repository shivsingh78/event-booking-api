import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { env } from "../src/config/env.js";

describe("Authentication & Authorization API", () => {
  const timestamp = Date.now();
  const customerEmail = `customer_${timestamp}@test.com`;
  const organizerEmail = `organizer_${timestamp}@test.com`;

  it("POST /api/auth/register registers a customer successfully", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: customerEmail,
        password: "ValidPassword123!",
      });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(customerEmail.toLowerCase());
    expect(res.body.user.role).toBe("customer");
    expect(res.body.accessToken).toBeDefined();
  });

  it("POST /api/auth/register rejects duplicate email", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: customerEmail,
        password: "ValidPassword123!",
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("POST /api/auth/register rejects weak or short password", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: `shortpass_${Date.now()}@test.com`,
        password: "short",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("POST /api/auth/organizers/register rejects without valid invitation token", async () => {
    const res = await request(app)
      .post("/api/auth/organizers/register")
      .set("x-organizer-invite", "wrong-token")
      .send({
        email: organizerEmail,
        password: "ValidPassword123!",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("INVALID_ORGANIZER_INVITATION");
  });

  it("POST /api/auth/organizers/register registers organizer with valid token", async () => {
    const res = await request(app)
      .post("/api/auth/organizers/register")
      .set("x-organizer-invite", env.ORGANIZER_INVITE_TOKEN!)
      .send({
        email: organizerEmail,
        password: "ValidPassword123!",
      });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("organizer");
    expect(res.body.accessToken).toBeDefined();
  });

  it("POST /api/auth/login logs in user with correct password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: customerEmail,
        password: "ValidPassword123!",
      });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(customerEmail.toLowerCase());
    expect(res.body.accessToken).toBeDefined();
  });

  it("POST /api/auth/login rejects incorrect password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: customerEmail,
        password: "WrongPassword999!",
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_CREDENTIALS");
  });

  it("Protected route returns 401 when no token is provided", async () => {
    const res = await request(app).get("/api/events/mine");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("AUTHENTICATION_REQUIRED");
  });

  it("Protected organizer route returns 403 when accessed by customer", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        email: customerEmail,
        password: "ValidPassword123!",
      });

    const token = loginRes.body.accessToken;

    const res = await request(app)
      .get("/api/events/mine")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("INSUFFICIENT_PERMISSIONS");
  });
});