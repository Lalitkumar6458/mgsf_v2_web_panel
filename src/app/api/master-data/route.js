import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { forbidden } from "@/lib/errors.js";
import { listMasterData, addMasterItems } from "@/services/masterData.js";

/** GET ?all=1 (include inactive) &usage=1 (member counts) — every trust login can read the lists */
export const GET = route(async ({ auth, query }) => {
  if (!auth.adminId) throw forbidden();
  const admin = auth.role === "admin";
  return {
    lists: await listMasterData(auth.adminId, {
      includeInactive: admin && query.get("all") === "1",
      withUsage: admin && query.get("usage") === "1",
    }),
  };
});

/** POST { type, label, labelEn?, value?, parentValue?, sortOrder? } or { type, parentValue?, lines: ["…", …] } */
export const POST = route(async ({ request, auth }) => {
  adminOnly(auth);
  const b = await readJson(request);
  const items = Array.isArray(b.lines)
    ? b.lines.map((l) => String(l).trim()).filter(Boolean).map((l) => {
        const [label, labelEn] = l.split("|").map((x) => x.trim());
        return { label, labelEn, parentValue: b.parentValue };
      })
    : [b];
  return { success: true, items: await addMasterItems(auth.adminId, b.type, items) };
});
