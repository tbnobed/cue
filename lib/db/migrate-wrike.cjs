// Run before drizzle push. New installs have no Wrike tables yet; old installs
// need explicit backfill BEFORE Drizzle attempts to add NOT NULL ownership.
const { Pool } = require("pg");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const { rows } = await pool.query("SELECT to_regclass('public.wrike_connections') AS existing");
  if (rows[0].existing) {
    await pool.query(readFileSync(path.join(__dirname, "../../scripts/wrike-personal.sql"), "utf8"));
    console.log("Wrike personal-connection migration applied.");
  }
})().catch(() => {
  console.error("Wrike ownership migration failed. Database changes rolled back; inspect existing ownership before retrying.");
  process.exitCode = 1;
}).finally(() => pool.end());
