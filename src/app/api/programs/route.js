import { sql } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { programFields } from "@/services/programs.js";
import { badRequest } from "@/lib/errors.js";
import { camel } from "@/lib/case.js";
import { normalizeCountDisplay, displayCount } from "@/lib/memberCountDisplay.js";

/** Programs of my trust, with live member counts (replaces stored memberCount / inactivemembercount). */
export const GET = route(async ({ auth }) => {
  const { rows } = await db.execute(sql`
    SELECT p.*,
      count(m.id) FILTER (WHERE NOT m.deleted AND m.status = 'accepted' AND m.active AND NOT m.blocked)::int AS active_members,
      count(m.id) FILTER (WHERE NOT m.deleted AND (NOT m.active OR m.blocked))::int AS inactive_members,
      count(m.id) FILTER (WHERE NOT m.deleted AND m.status = 'pending')::int AS pending_requests,
      count(m.id) FILTER (WHERE NOT m.deleted AND m.closing_date IS NOT NULL)::int AS closed_members,
      count(m.id) FILTER (WHERE NOT m.deleted AND m.status IN ('accepted', 'closed'))::int AS total_members
    FROM programs p LEFT JOIN members m ON m.program_id = p.id
    WHERE p.admin_id = ${auth.adminId}
    GROUP BY p.id
    ORDER BY p.created_at DESC`);
  // displayMembers = the count as the trust chose to show it (Yojna → Member count kaise dikhe)
  return { programs: camel(rows).map((p) => ({ ...p, displayMembers: displayCount(p.totalMembers, auth.features?.countDisplay === false ? null : p.extra?.countDisplay) })) };
});

export const POST = route(async ({ request, auth }) => {
  adminOnly(auth);
  const f = programFields(await readJson(request));
  if (!f.name) throw badRequest("name required");
  if (f.extra) f.extra = { ...f.extra, countDisplay: normalizeCountDisplay(f.extra.countDisplay, {}, 0) };
  if (f.isSelected) await db.update(schema.programs).set({ isSelected: false }).where(sql`${schema.programs.adminId} = ${auth.adminId}`);
  const [p] = await db.insert(schema.programs).values({ ...f, adminId: auth.adminId }).returning();
  return { success: true, program: p };
});
