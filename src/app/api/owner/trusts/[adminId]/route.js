import { eq, and } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { requireRole } from "@/lib/auth.js";
import { notFound } from "@/lib/errors.js";

/** Owner: rename a trust / turn its admin login on or off. PATCH { displayName?, active? } */
export const PATCH = route(async ({ request, auth, params }) => {
  requireRole(auth, "owner");
  const b = await readJson(request);
  const t = await db.query.admins.findFirst({ where: eq(schema.admins.id, params.adminId) });
  if (!t) throw notFound("Trust not found");
  if (b.displayName) {
    await db.update(schema.admins).set({ displayName: String(b.displayName) }).where(eq(schema.admins.id, t.id));
    await db.update(schema.accounts).set({ displayName: String(b.displayName) })
      .where(and(eq(schema.accounts.adminId, t.id), eq(schema.accounts.role, "admin")));
  }
  if (b.active !== undefined) {
    await db.update(schema.accounts).set({ active: !!b.active })
      .where(and(eq(schema.accounts.adminId, t.id), eq(schema.accounts.role, "admin")));
  }
  return { success: true };
});

/** Owner: "delete" = disable the trust's admin login. Data is never removed from here. */
export const DELETE = route(async ({ auth, params }) => {
  requireRole(auth, "owner");
  await db.update(schema.accounts).set({ active: false })
    .where(and(eq(schema.accounts.adminId, params.adminId), eq(schema.accounts.role, "admin")));
  return { success: true };
});
