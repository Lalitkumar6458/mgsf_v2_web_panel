import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { updateUser, deleteUser } from "@/services/users.js";

/** PATCH { displayName?, email?, phone?, roleId?, active?, password? } */
export const PATCH = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  return updateUser(auth.adminId, params.id, await readJson(request), auth);
});

export const DELETE = route(async ({ auth, params }) => {
  adminOnly(auth);
  return deleteUser(auth.adminId, params.id, auth);
});
