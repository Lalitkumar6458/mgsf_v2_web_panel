// { ready } — add-member / accept forms show the "WhatsApp par welcome bhejein" box only when the
// join template is set (Settings → WhatsApp) and WhatsApp is on for the trust.
import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { joinStatus } from "@/services/whatsapp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth }) => {
  adminOnly(auth);
  return joinStatus(auth.adminId);
});
