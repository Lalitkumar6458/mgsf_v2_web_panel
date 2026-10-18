// Settings → Mobile App (admin): maintenance, app update, payments in the app, support contacts.
import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { getAppSettings, saveAppSettings } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth }) => {
  adminOnly(auth);
  return { settings: await getAppSettings(auth.adminId) };
});
export const PUT = route(async ({ auth, request }) => {
  adminOnly(auth);
  return { success: true, settings: await saveAppSettings(auth.adminId, await readJson(request)) };
});
