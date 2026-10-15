import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { listRoles, createRole } from "@/services/users.js";

export const GET = route(async ({ auth }) => {
  adminOnly(auth);
  return { roles: await listRoles(auth.adminId) };
});

/** POST { name, description, permissions: { members: ["view","add"], … } } */
export const POST = route(async ({ request, auth }) => {
  adminOnly(auth);
  return { success: true, role: await createRole(auth.adminId, await readJson(request), auth) };
});
