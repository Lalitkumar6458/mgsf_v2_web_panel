// POST { memberIds } → { urls: { [memberId]: "https://<site>/verify/c/<signed code>" } }
// for the "Verify QR" element of a certificate design. Only members of the caller's trust.
import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { publicOrigin } from "@/lib/access.js";
import { certificateCode } from "@/services/verify.js";

export const POST = route(async ({ request, auth }) => {
  const { memberIds } = await readJson(request);
  const ids = (Array.isArray(memberIds) ? memberIds : []).map(String).filter(Boolean).slice(0, 5000);
  if (!ids.length || !auth.adminId) return { urls: {} };
  const { rows } = await db.execute(sql`
    SELECT m.id FROM members m JOIN programs p ON p.id = m.program_id
    WHERE p.admin_id = ${auth.adminId} AND m.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  const base = publicOrigin(request);
  return { urls: Object.fromEntries(rows.map((r) => [r.id, `${base}/verify/c/${encodeURIComponent(certificateCode(r.id))}`])) };
});
