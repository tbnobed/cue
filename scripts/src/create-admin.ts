/**
 * Create or promote a LOCAL admin account.
 *
 * Usage (from the workspace root):
 *   pnpm create-admin --email you@example.com --password 'hunter2hunter2' [--name 'Your Name']
 *
 * Or interactively (no flags) — prompts for each field. Password input is hidden.
 *
 * This is the ONLY supported way to mint the first admin on a fresh Studio
 * Command install. The HTTP signup endpoint requires an existing admin
 * session, so the bootstrap admin must come from the server side.
 *
 * If the email already exists as a local account, this command rotates its
 * password and ensures isAdmin=true.
 */

import readline from "node:readline";
import { Writable } from "node:stream";
import bcrypt from "bcryptjs";
import { db, usersTable, pool } from "@workspace/db";
import { eq, and, isNotNull, sql } from "drizzle-orm";

const BCRYPT_COST = 12;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith("--")) {
        out[key] = val;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function prompt(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    const muted = new Writable({
      write(chunk, _enc, cb) {
        if (!opts.hidden) process.stdout.write(chunk);
        cb();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
    process.stdout.write(question);
    rl.question("", (answer) => { rl.close(); if (opts.hidden) process.stdout.write("\n"); resolve(answer); });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Read from env as a fallback (convenient for docker-compose first-boot).
  const email = (args.email ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? (await prompt("Email: "))).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`Invalid email: ${email}`);
    process.exit(2);
  }
  const password = args.password ?? process.env.BOOTSTRAP_ADMIN_PASSWORD ?? (await prompt("Password (hidden): ", { hidden: true }));
  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(2);
  }
  const name = (args.name ?? process.env.BOOTSTRAP_ADMIN_NAME ?? email.split("@")[0]).trim() || email.split("@")[0];

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const [existing] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(sql`lower(${usersTable.email})`, email), isNotNull(usersTable.passwordHash)));

  if (existing) {
    // Recovery path: also force isActive=true so a previously-suspended admin
    // can be unlocked by re-running the bootstrap (the whole point of this
    // script is "I lost access, give it back to me").
    await db.update(usersTable)
      .set({ passwordHash, isAdmin: true, isActive: true, name })
      .where(eq(usersTable.id, existing.id));
    console.log(`✓ Updated existing local account ${email} — password rotated, isAdmin=true, isActive=true.`);
  } else {
    const [row] = await db.insert(usersTable)
      .values({ email, name, passwordHash, isAdmin: true, isActive: true, lastLoginAt: new Date() })
      .returning({ id: usersTable.id });
    console.log(`✓ Created admin account ${email} (id=${row!.id}).`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("create-admin failed:", err);
  process.exit(1);
});
