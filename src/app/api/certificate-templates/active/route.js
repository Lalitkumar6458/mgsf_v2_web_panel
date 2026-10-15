import { route } from "@/lib/http.js";
import { forbidden } from "@/lib/errors.js";
import { OWNER_NO_TRUST } from "@/lib/access.js";
import { getActiveTemplate } from "@/services/certificateTemplates.js";

/**
 * GET ?programId= — the design a member certificate of this yojna prints with
 * (bound to the yojna, else the default). { template: null } = use the built-in certificate.
 */
export const GET = route(async ({ auth, query }) => {
  if (!auth.adminId) throw forbidden(OWNER_NO_TRUST);
  if (auth.role === "member") throw forbidden();
  return { template: await getActiveTemplate(auth.adminId, query.get("programId") || null) };
});
