// GET → CSV of the new members' login passwords (reg. no. + password)
import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { importLoginsCsv } from "@/services/excelImport.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, params }) => {
  adminOnly(auth);
  const p = await getProgramFor(auth, params.programId);
  const csv = await importLoginsCsv(p.adminId, params.jobId);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="import-logins.csv"' } });
});
