import { Worker, Job } from "bullmq";
import { QUEUE_NAME, createRedisConnection, notificationQueue } from "./jobs/queue.js";
import {
  sendBookingConfirmationEmail,
  sendEventUpdateEmail,
  BookingConfirmationParams,
  EventUpdateParams,
} from "./jobs/emailService.js";
import { pool } from "./db/pool.js";

console.log("[Worker] Starting Background Email Worker...");

const workerConnection = createRedisConnection();

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    console.log(`[Worker] Processing job ${job.id} of type ${job.name}`);

    if (job.name === "booking_confirmation") {
      const data = job.data as BookingConfirmationParams & { outboxId?: string };
      await sendBookingConfirmationEmail(data);

      if (data.outboxId) {
        await pool.query(
          `UPDATE outbox_notifications
           SET status = 'completed', processed_at = NOW()
           WHERE id = $1`,
          [data.outboxId]
        );
      }
    } else if (job.name === "event_updated") {
      const data = job.data as EventUpdateParams & { outboxId?: string };
      await sendEventUpdateEmail(data);

      if (data.outboxId) {
        await pool.query(
          `UPDATE outbox_notifications
           SET status = 'completed', processed_at = NOW()
           WHERE id = $1`,
          [data.outboxId]
        );
      }
    } else {
      console.warn(`[Worker] Unknown job name: ${job.name}`);
    }
  },
  {
    connection: workerConnection,
    concurrency: 5,
  }
);

worker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} (${job.name}) completed successfully.`);
});

worker.on("failed", async (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed with error:`, err.message);

  if (job?.data?.outboxId) {
    try {
      await pool.query(
        `UPDATE outbox_notifications
         SET retry_count = retry_count + 1,
             error_message = $1,
             status = CASE WHEN retry_count >= 3 THEN 'failed' ELSE 'pending' END
         WHERE id = $2`,
        [err.message, job.data.outboxId]
      );
    } catch (dbErr) {
      console.error("[Worker] Failed to update outbox failure status:", dbErr);
    }
  }
});

// Outbox Poller: resilient dispatcher that guarantees delivery even across Redis blips
let isPolling = false;

async function pollOutbox() {
  if (isPolling) return;
  isPolling = true;

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`
        SELECT id, event_type, aggregate_type, aggregate_id, payload, retry_count
        FROM outbox_notifications
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 50
        FOR UPDATE SKIP LOCKED
      `);

      for (const row of result.rows) {
        if (row.event_type === "booking_confirmation") {
          const payload = row.payload;
          await notificationQueue.add(
            "booking_confirmation",
            {
              outboxId: row.id,
              to: payload.customerEmail,
              bookingId: payload.bookingId,
              eventTitle: payload.eventTitle,
              venue: payload.eventVenue,
              startsAt: payload.eventStartsAt,
              quantity: payload.quantity,
            },
            {
              jobId: `outbox_${row.id}`,
            }
          );
          await client.query(
            "UPDATE outbox_notifications SET status = 'processing' WHERE id = $1",
            [row.id]
          );
        } else if (row.event_type === "event_updated") {
          const payload = row.payload;
          const recipients = payload.recipients as Array<{ email: string }> || [];

          for (const recipient of recipients) {
            await notificationQueue.add(
              "event_updated",
              {
                outboxId: row.id,
                to: recipient.email,
                eventTitle: payload.newTitle,
                venue: payload.venue,
                startsAt: payload.startsAt,
                changeSummary: payload.changeSummary,
              },
              {
                jobId: `outbox_${row.id}_${recipient.email}`,
              }
            );
          }
          await client.query(
            "UPDATE outbox_notifications SET status = 'processing' WHERE id = $1",
            [row.id]
          );
        }
      }

      await client.query("COMMIT");
    } catch (pollErr) {
      await client.query("ROLLBACK");
      console.error("[OutboxPoller] Error during outbox poll:", pollErr);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[OutboxPoller] Connection error:", err);
  } finally {
    isPolling = false;
  }
}

// Poll outbox every 4 seconds
const outboxInterval = setInterval(() => {
  pollOutbox().catch(console.error);
}, 4000);

// Run initial poll immediately
pollOutbox().catch(console.error);

async function shutdown() {
  console.log("[Worker] Shutting down background worker...");
  clearInterval(outboxInterval);
  await worker.close();
  await workerConnection.quit();
  await pool.end();
  console.log("[Worker] Worker shut down cleanly.");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());