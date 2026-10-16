// Settings → Rasid: GET the trust's receipt design; PUT to save it (trust settings edit).
import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { getReceiptSettings, saveReceiptSettings } from "@/services/receiptSettings.js";
import { RECEIPT_LAYOUTS, RECEIPT_THEMES, DEFAULT_RECEIPT_SETTINGS } from "@/lib/receiptSettings.js";

export const GET = route(async ({ auth }) => {
  adminOnly(auth);
  return { settings: await getReceiptSettings(auth.adminId), layouts: RECEIPT_LAYOUTS, themes: RECEIPT_THEMES, defaults: DEFAULT_RECEIPT_SETTINGS };
});

export const PUT = route(async ({ request, auth }) => {
  adminOnly(auth);
  return { success: true, settings: await saveReceiptSettings(auth.adminId, await readJson(request)) };
});
