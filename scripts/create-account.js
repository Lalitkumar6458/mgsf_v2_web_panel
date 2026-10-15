// Create the first login.
//   node --env-file=.env scripts/create-account.js owner you@mail.com "Your Name" StrongPass123
//   node --env-file=.env scripts/create-account.js admin trust@mail.com "Trust Name" StrongPass123
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const [role, emailArg, name, password] = process.argv.slice(2);
if (!["owner", "admin"].includes(role) || !emailArg || !name || !password || password.length < 8) {
  console.log('Usage: node --env-file=.env scripts/create-account.js <owner|admin> <email> "<name>" <password(8+)>');
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  let adminId = null;
  if (role === "admin") {
    adminId = randomUUID();
    await db.query("INSERT INTO admins (id, email, display_name) VALUES ($1, $2, $3)", [adminId, email, name]);
  }
  await db.query(
    `INSERT INTO accounts (id, role, login_id, email, display_name, password_hash, admin_id)
     VALUES ($1, $2, $3, $3, $4, $5, $6)`,
    [randomUUID(), role, email, name, await bcrypt.hash(password, 10), adminId],
  );
  await db.query("COMMIT");
  console.log(`✔ ${role} login created: ${email}${adminId ? `  (trust id ${adminId})` : ""}`);
} catch (e) {
  await db.query("ROLLBACK");
  console.error("✖", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
