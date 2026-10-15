import { sql } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { badRequest } from "@/lib/errors.js";
import { camel } from "@/lib/case.js";

export const GET = route(async ({ auth, params }) => {
  await getProgramFor(auth, params.programId);
  const { rows } = await db.execute(sql`
    SELECT g.*, count(m.id)::int AS member_count
    FROM closing_groups g LEFT JOIN members m ON m.closing_group_id = g.id AND NOT m.deleted
    WHERE g.program_id = ${params.programId}
    GROUP BY g.id ORDER BY g.created_at DESC`);
  return { groups: camel(rows) };
});

export const POST = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  await getProgramFor(auth, params.programId);
  const { name } = await readJson(request);
  if (!name) throw badRequest("name required");
  const [g] = await db.insert(schema.closingGroups).values({ programId: params.programId, name: String(name).trim() }).returning();
  return { success: true, group: g };
});
