// POST { title, body, to, programId?, memberIds?, agentIds? } — panel sends an Expo push + inbox message
import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { sendNotification } from "@/services/notifySend.js";

export const POST = route(async ({ request, auth }) => {
  adminOnly(auth);
  return { success: true, ...(await sendNotification(auth.adminId, await readJson(request), auth.displayName || "")) };
});
