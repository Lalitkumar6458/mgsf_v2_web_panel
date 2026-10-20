// POST multipart "file" (.xlsx / .csv) → row-wise check + preview. Nothing is written.
import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { badRequest } from "@/lib/errors.js";
import { checkUpload } from "@/services/excelImport.js";

export const dynamic = "force-dynamic";
export const POST = route(async ({ auth, params, request }) => {
  adminOnly(auth);
  const p = await getProgramFor(auth, params.programId);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw badRequest("File chunein");
  return checkUpload(p, Buffer.from(await file.arrayBuffer()), file.name || "");
});
