import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { updateMasterItem, deleteMasterItem } from "@/services/masterData.js";

/** PATCH { label?, labelEn?, sortOrder?, active? } */
export const PATCH = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  return { success: true, item: await updateMasterItem(auth.adminId, params.id, await readJson(request)) };
});

export const DELETE = route(async ({ auth, params }) => {
  adminOnly(auth);
  return deleteMasterItem(auth.adminId, params.id);
});
