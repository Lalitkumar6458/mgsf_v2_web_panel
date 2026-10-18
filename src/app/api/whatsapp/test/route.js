// POST { event, phone, memberId? } — one test message to any number.
import { route, readJson } from "@/lib/http.js";
import { adminOnly, publicOrigin } from "@/lib/access.js";
import { testSend } from "@/services/whatsapp.js";

export const POST = route(async ({ auth, request }) => {
  adminOnly(auth);
  return { success: true, ...(await testSend(auth.adminId, await readJson(request), publicOrigin(request))) };
});
