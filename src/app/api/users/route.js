import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { listUsers, createUser } from "@/services/users.js";

export const GET = route(async ({ auth }) => {
  adminOnly(auth);
  return { users: await listUsers(auth.adminId) };
});

/** POST { displayName, email, phone, password, roleId } */
export const POST = route(async ({ request, auth }) => {
  adminOnly(auth);
  return createUser(auth.adminId, await readJson(request), auth);
});
