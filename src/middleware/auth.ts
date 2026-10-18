import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

type Role = "customer" | "organizer";

export const authenticate: RequestHandler = (req, res, next) => {
  const authorization = req.header("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "AUTHENTICATION_REQUIRED",
    });
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (!token) {
    return res.status(401).json({
      error: "AUTHENTICATION_REQUIRED",
    });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);

    if (
      typeof decoded === "string" ||
      typeof decoded.sub !== "string" ||
      (decoded.role !== "customer" && decoded.role !== "organizer")
    ) {
      return res.status(401).json({
        error: "INVALID_TOKEN",
      });
    }

    req.auth = {
      userId: decoded.sub,
      role: decoded.role as Role,
    };

    next();
  } catch {
    return res.status(401).json({
      error: "INVALID_OR_EXPIRED_TOKEN",
    });
  }
};

export function requireRole(...allowedRoles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({
        error: "AUTHENTICATION_REQUIRED",
      });
    }

    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({
        error: "INSUFFICIENT_PERMISSIONS",
      });
    }

    next();
  };
}