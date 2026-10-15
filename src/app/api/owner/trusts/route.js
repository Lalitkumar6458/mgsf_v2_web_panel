import { sql } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { requireRole, hashPassword } from "@/lib/auth.js";
import { badRequest, conflict } from "@/lib/errors.js";
import { camel } from "@/lib/case.js";
import { eq } from "drizzle-orm";

/** Owner (super admin) — list trusts (old /owner/home/users) */
export const GET = route(async ({ auth }) => {
  requireRole(auth, "owner");
  const { rows } = await db.execute(sql`
    SELECT ad.*, acc.active AS login_active, acc.last_login_at,
      (SELECT count(*) FROM programs p WHERE p.admin_id = ad.id)::int AS programs,
      (SELECT count(*) FROM members m JOIN programs p ON p.id = m.program_id WHERE p.admin_id = ad.id AND NOT m.deleted)::int AS members
    FROM admins ad LEFT JOIN accounts acc ON acc.admin_id = ad.id AND acc.role = 'admin'
    ORDER BY ad.created_at`);
  return { trusts: camel(rows) };
});

/** POST { displayName, email, password, phone } — create a trust + its admin login */
export const POST = route(async ({ request, auth }) => {
  requireRole(auth, "owner");
  const { displayName, email, password, phone = "" } = await readJson(request);
  if (!displayName || !email || !password || String(password).length < 6) throw badRequest("displayName, email, password (6+) required");
  const e = String(email).trim().toLowerCase();
  if (await db.query.accounts.findFirst({ where: eq(schema.accounts.loginId, e) })) throw conflict("Email already used");
  return db.transaction(async (tx) => {
    const [ad] = await tx.insert(schema.admins).values({ displayName, email: e, phone }).returning();
    await tx.insert(schema.accounts).values({ role: "admin", loginId: e, email: e, phone, displayName, passwordHash: await hashPassword(password), adminId: ad.id });
    return { success: true, trust: ad };
  });
});
