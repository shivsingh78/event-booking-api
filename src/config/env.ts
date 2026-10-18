import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(50),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  ORGANIZER_INVITE_TOKEN: z.string().optional(),
  BOOKING_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20_000),
});

export const env = envSchema.parse(process.env);