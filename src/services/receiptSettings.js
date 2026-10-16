// Settings → Rasid: stored in admins.extra.receipt (see lib/receiptSettings.js).
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { normalizeReceiptSettings } from "../lib/receiptSettings.js";
import { toDataUri } from "./trust.js";

export async function getReceiptSettings(adminId) {
  const { rows: [r] } = await db.execute(sql`SELECT extra->'receipt' AS s FROM admins WHERE id = ${adminId}`);
  return normalizeReceiptSettings(r?.s);
}

export async function saveReceiptSettings(adminId, input) {
  const s = normalizeReceiptSettings(input);
  await db.execute(sql`UPDATE admins SET extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('receipt', ${JSON.stringify(s)}::jsonb), updated_at = now() WHERE id = ${adminId}`);
  return s;
}

/**
 * For the PDF worker: settings with the signature image loaded as a data URI, and the
 * developer's feature lock applied (features = auth.features: upiQr / verifyQr switched off).
 */
export async function receiptSettingsForPdf(adminId, features = null, raw = null) {
  const s = raw ? normalizeReceiptSettings(raw) : await getReceiptSettings(adminId);
  return {
    ...s,
    showUpiQr: s.showUpiQr && features?.upiQr !== false,
    showVerifyQr: s.showVerifyQr && features?.verifyQr !== false,
    signImg: s.signImg ? (await toDataUri(s.signImg)) || "" : "",
  };
}
