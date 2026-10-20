// GET: live progress of one import · POST { action: "undo" | "dropLogins" }
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { badRequest } from "@/lib/errors.js";
import { getImport, undoImport, dropImportLogins } from "@/services/excelImport.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, params }) => {
  adminOnly(auth);
  const p = await getProgramFor(auth, params.programId);
  return { job: await getImport(p.adminId, params.jobId) };
});
export const POST = route(async ({ auth, params, request }) => {
  adminOnly(auth);
  const p = await getProgramFor(auth, params.programId);
  const { action } = await readJson(request);
  if (action === "undo") return undoImport(p.adminId, params.jobId);
  if (action === "dropLogins") return dropImportLogins(p.adminId, params.jobId);
  throw badRequest("action?");
});
