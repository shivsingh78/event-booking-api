import { describe, it, expect, beforeAll } from "vitest";
import { pool } from "../src/db/pool.js";
import { notificationQueue } from "../src/jobs/queue.js";
import { sendBookingConfirmationEmail, sendEventUpdateEmail } from "../src/jobs/emailService.js";

describe("Background Email & Worker Processing", () => {
  it("sendBookingConfirmationEmail handles parameters correctly", async () => {
    const result = await sendBookingConfirmationEmail({
      to: "testcustomer@example.com",
      bookingId: "test-booking-uuid-1234",
      eventTitle: "Rock Fest 2026",
      venue: "Madison Square Arena",
      startsAt: new Date().toISOString(),
      quantity: 2,
    });

    expect(result).toBeDefined();
  });

  it("sendEventUpdateEmail handles parameters correctly", async () => {
    const result = await sendEventUpdateEmail({
      to: "testcustomer@example.com",
      eventTitle: "Rock Fest 2026 - Rescheduled",
      venue: "Madison Square Arena (Gate 4)",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      changeSummary: "Time updated",
    });

    expect(result).toBeDefined();
  });

  it("enqueues and receives jobs on BullMQ notification queue", async () => {
    const job = await notificationQueue.add(
      "booking_confirmation",
      {
        to: "queue_test@example.com",
        bookingId: "test-uuid-queue",
        eventTitle: "Queue Test Event",
        venue: "Virtual Stage",
        startsAt: new Date().toISOString(),
        quantity: 1,
      },
      { jobId: `test_job_${Date.now()}` }
    );

    expect(job.id).toBeDefined();
    const fetched = await notificationQueue.getJob(job.id!);
    expect(fetched).toBeDefined();
    expect(fetched?.name).toBe("booking_confirmation");
  });
});