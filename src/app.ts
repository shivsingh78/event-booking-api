import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pool } from "./db/pool.js";
import authRoutes from './routes/auth.routes.js'
import eventRoutes from "./routes/events.routes.js";
const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "event-booking-api",
  });
});

app.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "ready",
      database: "connected",
    });
  } catch {
    res.status(503).json({
      status: "not_ready",
      database: "unavailable",
    });
  }
});

export default app;