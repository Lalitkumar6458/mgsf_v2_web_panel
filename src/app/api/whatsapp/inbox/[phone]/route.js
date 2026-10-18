// GET one conversation (marks it read) · POST { text } reply (within 24 h of the member's last message).
import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { thread, reply } from "@/services/whatsapp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, params }) => {
  adminOnly(auth);
  return thread(auth.adminId, params.phone);
});
export const POST = route(async ({ auth, params, request }) => {
  adminOnly(auth);
  const { text } = await readJson(request);
  return { success: true, ...(await reply(auth.adminId, params.phone, text, auth.displayName || "")) };
});
