import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { getTemplate, saveTemplate, deleteTemplate } from "@/services/certificateTemplates.js";

export const GET = route(async ({ auth, params }) => {
  adminOnly(auth);
  return { template: await getTemplate(auth.adminId, params.id) };
});

/** PATCH — replace the whole design (name, yojna, page, frame, elements). */
export const PATCH = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  return { success: true, template: await saveTemplate(auth.adminId, await readJson(request), params.id, auth.accountId) };
});

export const DELETE = route(async ({ auth, params }) => {
  adminOnly(auth);
  return { success: true, ...(await deleteTemplate(auth.adminId, params.id)) };
});
