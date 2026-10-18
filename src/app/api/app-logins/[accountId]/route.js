// One app login: GET its phones · DELETE ?sessionId= (one phone) or no id (every phone) → logged out
import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { loginPhones, logoutPhones } from "@/services/appLogins.js";

export const GET = route(async ({ auth, params }) => {
  adminOnly(auth);
  return { phones: await loginPhones(auth.adminId, params.accountId) };
});

export const DELETE = route(async ({ auth, params, query }) => {
  adminOnly(auth);
  return { success: true, ...(await logoutPhones(auth.adminId, params.accountId, { sessionId: query.get("sessionId") || null })) };
});
