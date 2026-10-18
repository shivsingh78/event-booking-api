import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const QUEUE_NAME = "event-email-notifications";

export function createRedisConnection() {
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  });

  connection.on("error", (err) => {
    // Avoid noisy crash on temporary redis reconnect
    if (env.NODE_ENV !== "test") {
      console.error("[Redis connection error]", err.message);
    }
  });

  return connection;
}

const redisConnection = createRedisConnection();

export const notificationQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});