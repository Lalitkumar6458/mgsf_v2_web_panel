// Settings → WhatsApp (admin): Gupshup app + the 3 templates. GET also returns the callback URL.
import { route, readJson } from "@/lib/http.js";
import { adminOnly, publicOrigin } from "@/lib/access.js";
import { whatsappForPanel, saveWhatsapp } from "@/services/whatsapp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, request }) => {
  adminOnly(auth);
  return whatsappForPanel(auth.adminId, publicOrigin(request));
});
export const PUT = route(async ({ auth, request }) => {
  adminOnly(auth);
  await saveWhatsapp(auth.adminId, await readJson(request));
  return { success: true, ...(await whatsappForPanel(auth.adminId, publicOrigin(request))) };
});
