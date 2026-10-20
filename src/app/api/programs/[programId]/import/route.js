// Excel / CSV import — GET: past imports of this yojna · POST { token, skipErrorRows }: start the checked file
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { listImports, startChecked } from "@/services/excelImport.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, params }) => {
  adminOnly(auth);
  const p = await getProgramFor(auth, params.programId);
  return { imports: await listImports(p.adminId, p.id) };
});
export const POST = route(async ({ auth, params, request }) => {
  adminOnly(auth);
  const p = await getProgramFor(auth, params.programId);
  const body = await readJson(request);
  return startChecked(p, body.token, auth, { skipErrorRows: !!body.skipErrorRows });
});
