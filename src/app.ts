import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pool } from "./db/pool.js";
import { createRedisConnection } from "./jobs/queue.js";
import authRoutes from "./routes/auth.routes.js";
import eventRoutes from "./routes/events.routes.js";
import bookingRoutes from "./routes/bookings.routes.js";
import { apiRateLimiter } from "./middleware/rateLimit.js";

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "100kb" }));

// General rate limiter for non-exempt endpoints
app.use("/api", apiRateLimiter);

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/bookings", bookingRoutes);

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "event-booking-api",
    timestamp: new Date().toISOString(),
  });
});

// Database & Redis readiness probe
app.get("/ready", async (_req, res) => {
  let dbStatus = "unknown";
  let redisStatus = "unknown";

  try {
    await pool.query("SELECT 1");
    dbStatus = "connected";
  } catch (err) {
    dbStatus = "unavailable";
  }

  try {
    const redis = createRedisConnection();
    await redis.ping();
    await redis.quit();
    redisStatus = "connected";
  } catch (err) {
    redisStatus = "unavailable";
  }

  if (dbStatus === "connected" && redisStatus === "connected") {
    return res.status(200).json({
      status: "ready",
      database: dbStatus,
      redis: redisStatus,
    });
  }

  return res.status(503).json({
    status: "not_ready",
    database: dbStatus,
    redis: redisStatus,
  });
});

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: "The requested route does not exist.",
  });
});

// Centralized error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "INVALID_JSON_PAYLOAD",
      message: "The request body contains invalid JSON.",
    });
  }

  console.error("[Unhandled Error]", err);
  return res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
  });
});

export default app;