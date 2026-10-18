// GET ?programId= → how many members owe (bulk pending reminder).
// POST { event: "pending" | "join" | "paid", programId?, memberIds? } → sent in the background.
import { route, readJson } from "@/lib/http.js";
import { adminOnly, publicOrigin } from "@/lib/access.js";
import { bulkSend, pendingAudience } from "@/services/whatsapp.js";
import { later } from "@/lib/push.js";

export const GET = route(async ({ auth, query }) => {
  adminOnly(auth);
  return { members: (await pendingAudience(auth.adminId, { programId: query.get("programId") || "" })).length };
});
export const POST = route(async ({ auth, request }) => {
  adminOnly(auth);
  return { success: true, ...(await bulkSend(auth.adminId, await readJson(request), publicOrigin(request), later)) };
});
