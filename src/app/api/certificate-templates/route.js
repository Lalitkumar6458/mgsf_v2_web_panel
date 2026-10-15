import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { listTemplates, saveTemplate } from "@/services/certificateTemplates.js";

/** GET — every certificate design of this trust.  POST — save a new one. */
export const GET = route(async ({ auth }) => {
  adminOnly(auth);
  return { templates: await listTemplates(auth.adminId) };
});

export const POST = route(async ({ request, auth }) => {
  adminOnly(auth);
  return { success: true, template: await saveTemplate(auth.adminId, await readJson(request), null, auth.accountId) };
});
