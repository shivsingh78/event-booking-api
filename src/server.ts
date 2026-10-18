import app from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";

const server = app.listen(env.PORT, () => {
  console.log(`Event Booking API listening on port ${env.PORT}`);
});

async function shutdown() {
  console.log("Shutting down API...");

  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());