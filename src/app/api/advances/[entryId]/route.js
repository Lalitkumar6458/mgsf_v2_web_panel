// DELETE { reason } — cancel a wrong advance deposit / refund entry (admin). Payment entries are
// undone by reversing the payment itself.
import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { forbidden, notFound } from "@/lib/errors.js";
import { reverseAdvance } from "@/services/advances.js";

export const DELETE = route(async ({ auth, params, request }) => {
  adminOnly(auth);
  const { rows: [e] } = await db.execute(sql`
    SELECT p.admin_id FROM member_advances a JOIN programs p ON p.id = a.program_id WHERE a.id = ${params.entryId}`);
  if (!e) throw notFound("Entry nahi mili");
  if (auth.role !== "owner" && e.admin_id !== auth.adminId) throw forbidden();
  const body = await readJson(request).catch(() => ({}));
  return reverseAdvance(params.entryId, body || {}, auth);
});
