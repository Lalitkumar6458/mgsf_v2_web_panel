// Program (yojna) fields allowed from the API
const TEXT = ["name", "hiname", "guname", "noteLine", "about", "category", "regPrefix"];
const INT = ["regDigits", "regStartNo", "defaultPayAmount", "dueDays"];

export function programFields(b = {}) {
  const out = {};
  for (const k of TEXT) if (b[k] !== undefined) out[k] = String(b[k] ?? "").trim();
  for (const k of INT) if (b[k] !== undefined && b[k] !== "") out[k] = parseInt(b[k], 10) || 0;
  if (out.regPrefix) out.regPrefix = out.regPrefix.toUpperCase();
  if (out.dueDays !== undefined) out.dueDays = Math.min(Math.max(out.dueDays, 0), 365);
  if (out.regDigits) out.regDigits = Math.min(Math.max(out.regDigits, 3), 10);
  if (b.regMode !== undefined) out.regMode = b.regMode === "series" ? "series" : "random";
  if (b.isSelected !== undefined) out.isSelected = !!b.isSelected;
  if (b.syncPastClosingsOnAccept !== undefined) out.syncPastClosingsOnAccept = !!b.syncPastClosingsOnAccept;
  const withId = (arr) => (Array.isArray(arr) ? arr.map((g) => ({ ...g, id: g.id || crypto.randomUUID() })) : undefined);
  if (b.ageGroups !== undefined) out.ageGroups = withId(b.ageGroups) || [];
  if (b.locationGroups !== undefined) out.locationGroups = withId(b.locationGroups) || [];
  if (b.extra && typeof b.extra === "object") out.extra = b.extra;
  return out;
}

/** Members on books (active + inactive + blocked + closed; not pending, not deleted) — the "asli" count. */
export async function membersOnBooks(programId) {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../db/index.js");
  const { rows: [r] } = await db.execute(sql`
    SELECT count(*)::int AS n FROM members
    WHERE program_id = ${programId} AND NOT deleted AND status IN ('accepted', 'closed')`);
  return r?.n || 0;
}
