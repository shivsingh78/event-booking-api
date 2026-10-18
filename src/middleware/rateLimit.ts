import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { env } from "../config/env.js";

const isTest = env.NODE_ENV === "test" || Boolean(process.env.VITEST);

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? 10_000 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "RATE_LIMIT_EXCEEDED",
    message: "Too many authentication attempts. Please try again later.",
  },
});

export const bookingRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: isTest ? 100_000 : env.BOOKING_RATE_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    if (req.auth?.userId) {
      return `usr_${req.auth.userId}`;
    }
    return ipKeyGenerator(req.ip || "127.0.0.1");
  },
  message: {
    error: "RATE_LIMIT_EXCEEDED",
    message: "Too many booking requests for this user account. Please try again later.",
  },
});

export const apiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: isTest ? 100_000 : 20_000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "RATE_LIMIT_EXCEEDED",
    message: "Too many requests. Please try again later.",
  },
});