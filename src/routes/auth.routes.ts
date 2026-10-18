import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";

const router = Router();

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
});

type User = {
  id: string;
  email: string;
  password_hash: string;
  role: "customer" | "organizer";
};

function createToken(user: Pick<User, "id" | "role">) {
  return jwt.sign(
    { role: user.role },
    env.JWT_SECRET,
    {
      subject: user.id,
      expiresIn: "1h",
    },
  );
}

async function registerUser(
  email: string,
  password: string,
  role: User["role"],
) {
  const passwordHash = await bcrypt.hash(password, 12);

  const result = await pool.query<{
    id: string;
    email: string;
    role: User["role"];
  }>(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, $3)
     RETURNING id, email, role`,
    [email.toLowerCase(), passwordHash, role],
  );

  return result.rows[0]!;
}

// Public registration creates customer accounts only.
router.post("/register", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      details: parsed.error.flatten(),
    });
  }

  try {
    const user = await registerUser(
      parsed.data.email,
      parsed.data.password,
      "customer",
    );

    return res.status(201).json({
      user,
      accessToken: createToken(user),
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return res.status(409).json({
        error: "EMAIL_ALREADY_REGISTERED",
      });
    }

    console.error("Customer registration failed", error);
    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});

// Organizer registration requires a secret invitation token.
router.post("/organizers/register", async (req, res) => {
  const invitation = req.get("x-organizer-invite");

  if (
    !env.ORGANIZER_INVITE_TOKEN ||
    invitation !== env.ORGANIZER_INVITE_TOKEN
  ) {
    return res.status(403).json({
      error: "INVALID_ORGANIZER_INVITATION",
    });
  }

  const parsed = credentialsSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      details: parsed.error.flatten(),
    });
  }

  try {
    const user = await registerUser(
      parsed.data.email,
      parsed.data.password,
      "organizer",
    );

    return res.status(201).json({
      user,
      accessToken: createToken(user),
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return res.status(409).json({
        error: "EMAIL_ALREADY_REGISTERED",
      });
    }

    console.error("Organizer registration failed", error);
    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});

router.post("/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await pool.query<User>(
      `SELECT id, email, password_hash, role
       FROM users
       WHERE LOWER(email) = $1`,
      [parsed.data.email.toLowerCase()],
    );

    const user = result.rows[0];

    if (
      !user ||
      !(await bcrypt.compare(
        parsed.data.password,
        user.password_hash,
      ))
    ) {
      return res.status(401).json({
        error: "INVALID_CREDENTIALS",
      });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      accessToken: createToken(user),
    });
  } catch (error) {
    console.error("Login failed", error);
    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
    });
  }
});

export default router;