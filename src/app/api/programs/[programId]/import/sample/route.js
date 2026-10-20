// GET ?format=xlsx (default) | csv & sheet=members|payments → sample file with this yojna's agents / groups
import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { getProgramFor } from "@/lib/auth.js";
import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { sampleWorkbook, sampleCsv } from "@/services/excelImport.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, params, query }) => {
  adminOnly(auth);
  const p = await getProgramFor(auth, params.programId);
  if (query.get("format") === "csv") {
    const sheet = query.get("sheet") === "payments" ? "payments" : "members";
    return new Response(sampleCsv(sheet), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="import-${sheet}-sample.csv"` } });
  }
  const { rows: agents } = await db.execute(sql`SELECT display_name AS "displayName", email, agent_code AS "agentCode" FROM agents WHERE admin_id = ${p.adminId} AND NOT deleted ORDER BY display_name LIMIT 50`);
  const { rows: groups } = await db.execute(sql`SELECT name FROM closing_groups WHERE program_id = ${p.id} ORDER BY created_at DESC LIMIT 30`);
  const buf = await sampleWorkbook(p, { agents, groups });
  return new Response(buf, { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="import-sample.xlsx"' } });
});
