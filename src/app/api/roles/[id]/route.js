import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { updateRole, deleteRole } from "@/services/users.js";

export const PATCH = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  return { success: true, role: await updateRole(auth.adminId, params.id, await readJson(request), auth) };
});

export const DELETE = route(async ({ auth, params }) => {
  adminOnly(auth);
  return deleteRole(auth.adminId, params.id);
});
