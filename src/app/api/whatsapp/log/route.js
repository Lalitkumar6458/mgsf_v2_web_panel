// Sent WhatsApp messages with status (sent / delivered / read / failed). ?event=&status=&page=
import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { messageLog } from "@/services/whatsapp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, query }) => {
  adminOnly(auth);
  return messageLog(auth.adminId, { event: query.get("event") || "", status: query.get("status") || "", page: Number(query.get("page")) || 1 });
});
