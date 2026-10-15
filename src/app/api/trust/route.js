import { eq } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { normalizeTrust } from "@/lib/trust/profile.js";
import { updateTrustInfo } from "@/services/trust.js";

/**
 * Trust info, contact and policies (old organizations/trustInfo, contact, policies).
 * Everyone in the trust can read. `profile` = trust_info with defaults filled in (what PDFs use).
 */
export const GET = route(async ({ auth }) => {
  const t = await db.query.admins.findFirst({ where: eq(schema.admins.id, auth.adminId) });
  return { trust: t, profile: normalizeTrust(t?.trustInfo) };
});

/**
 * { profile: {...} }  → Settings → Organization (merged into trust_info, validated)
 * { contact | policies | trustInfo | displayName | phone } → raw update (settings lists)
 */
export const PATCH = route(async ({ request, auth }) => {
  adminOnly(auth);
  const b = await readJson(request);
  if (b.profile && typeof b.profile === "object") {
    const info = await updateTrustInfo(auth.adminId, b.profile, auth.accountId);
    return { success: true, profile: normalizeTrust(info) };
  }
  const patch = {};
  for (const k of ["displayName", "phone"]) if (b[k] !== undefined) patch[k] = String(b[k]);
  for (const k of ["trustInfo", "contact", "policies"]) if (b[k] && typeof b[k] === "object") patch[k] = b[k];
  const [t] = await db.update(schema.admins).set(patch).where(eq(schema.admins.id, auth.adminId)).returning();
  return { success: true, trust: t, profile: normalizeTrust(t?.trustInfo) };
});
