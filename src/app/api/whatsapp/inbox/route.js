// WhatsApp inbox: conversations (last message, unread). ?q=&page=
import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { inbox } from "@/services/whatsapp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, query }) => {
  adminOnly(auth);
  return inbox(auth.adminId, { q: query.get("q") || "", page: Number(query.get("page")) || 1 });
});
