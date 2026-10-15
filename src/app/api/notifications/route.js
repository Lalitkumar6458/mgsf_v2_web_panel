import { sql, eq, and, isNull, desc, or } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { notify } from "@/lib/push.js";
import { badRequest } from "@/lib/errors.js";

const { notifications } = schema;

/** My notifications (admin panel: accountId null; app users: their own) */
export const GET = route(async ({ auth, query }) => {
  const mine = auth.role === "admin" ? isNull(notifications.accountId) : eq(notifications.accountId, auth.accountId);
  const rows = await db.select().from(notifications)
    .where(and(eq(notifications.adminId, auth.adminId), mine))
    .orderBy(desc(notifications.createdAt)).limit(Number(query.get("limit")) || 50);
  return { notifications: rows, unread: rows.filter((n) => !n.readAt).length };
});

/**
 * Admin sends a push + in-app notification.
 * POST { title, body, to: "agents" | "members" | "all" | [accountId…], programId?, data? }
 */
export const POST = route(async ({ request, auth }) => {
  adminOnly(auth);
  const { title, body = "", to = "all", programId, data = {} } = await readJson(request);
  if (!title) throw badRequest("title required");
  let accountIds;
  if (Array.isArray(to)) {
    const { rows } = await db.execute(sql`SELECT id FROM accounts WHERE admin_id = ${auth.adminId} AND id IN (${sql.join(to.map((x) => sql`${x}`), sql`, `)})`);
    accountIds = rows.map((r) => r.id);
  } else {
    const roles = to === "agents" ? ["agent"] : to === "members" ? ["member"] : ["agent", "member"];
    const { rows } = await db.execute(sql`
      SELECT a.id FROM accounts a LEFT JOIN members m ON m.id = a.member_id
      WHERE a.admin_id = ${auth.adminId} AND a.active AND a.role::text IN (${sql.join(roles.map((r) => sql`${r}`), sql`, `)})
        ${programId ? sql`AND (a.role = 'agent' OR m.program_id = ${programId})` : sql``}`);
    accountIds = rows.map((r) => r.id);
  }
  const r = await notify(auth.adminId, accountIds, { title, body, data });
  return { success: true, ...r };
});

/** PATCH { ids?: [] } — mark read (all when no ids) */
export const PATCH = route(async ({ request, auth }) => {
  const { ids } = await readJson(request);
  const mine = auth.role === "admin" ? isNull(notifications.accountId) : eq(notifications.accountId, auth.accountId);
  let where = and(eq(notifications.adminId, auth.adminId), mine, isNull(notifications.readAt));
  if (Array.isArray(ids) && ids.length) where = and(where, sql`${notifications.id} IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
  await db.update(notifications).set({ readAt: new Date() }).where(where);
  return { success: true };
});
