import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log("Checking migration ledger...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Check if initial schema tables already exist
    const initialCheck = await client.query(`
      SELECT to_regclass('public.users') IS NOT NULL AS has_users,
             to_regclass('public.events') IS NOT NULL AS has_events,
             to_regclass('public.bookings') IS NOT NULL AS has_bookings;
    `);

    const hasTables =
      initialCheck.rows[0]?.has_users &&
      initialCheck.rows[0]?.has_events &&
      initialCheck.rows[0]?.has_bookings;

    // Check if 001_initial_schema.sql is already recorded
    const ledgerCheck = await client.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      ["001_initial_schema.sql"]
    );

    if (hasTables && ledgerCheck.rowCount === 0) {
      console.log("Existing tables detected. Marking 001_initial_schema.sql as already applied.");
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
        ["001_initial_schema.sql"]
      );
    }

    const migrationsDir = path.resolve(__dirname, "../../migrations");
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

    for (const file of sqlFiles) {
      const alreadyApplied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [file]
      );

      if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`Successfully applied: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`Failed to apply migration: ${file}`, err);
        throw err;
      }
    }

    console.log("All migrations are up to date.");
  } finally {
    client.release();
  }
}

// Run directly if executed as main module
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error("Migration error:", err);
      process.exit(1);
    });
}