import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import type { RequestHandler } from "express";

const WEAK_SECRETS = new Set(["", "change_me_in_production", "dev_only_secret_change_me"]);

let cached: RequestHandler | null = null;

export function getSessionMiddleware(): RequestHandler {
  if (cached) return cached;

  const secret = process.env.SESSION_SECRET ?? "";
  if (process.env.NODE_ENV === "production" && (secret.length < 16 || WEAK_SECRETS.has(secret))) {
    throw new Error("SESSION_SECRET is missing or weak — required for session cookies");
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required for session storage");

  const PgStore = connectPgSimple(session);
  const pool = new pg.Pool({ connectionString: dbUrl });
  const store = new PgStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
  });

  cached = session({
    store,
    secret: secret || "dev_only_secret_change_me",
    resave: false,
    saveUninitialized: false,
    name: "studiopm.sid",
    // Trust the X-Forwarded-Proto header set by the upstream proxy when
    // determining whether the connection is secure (mirrors `trust proxy` on the app).
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  });
  return cached;
}
