// Who may touch what.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { forbidden } from "./errors.js";

export const OWNER_NO_TRUST = "Owner login ke saath koi trust nahi juda — ye kaam trust ke admin login se karein.";

/** Admin (or owner) only. Trust work needs a trust: an owner login without one gets a clear message. */
export function adminOnly(auth) {
  if (auth.role !== "admin" && auth.role !== "owner") throw forbidden("Admin only");
  if (!auth.adminId) throw forbidden(OWNER_NO_TRUST);
}

/** Agents may only act on their own members. */
export async function assertAgentMembers(auth, programId, memberIds) {
  if (auth.role !== "agent") return;
  const ids = [...new Set(memberIds.filter(Boolean))];
  if (!ids.length) return;
  const { rows: [r] } = await db.execute(sql`
    SELECT count(*)::int AS n FROM members
    WHERE program_id = ${programId} AND agent_id = ${auth.agentId}
      AND id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
  if (r.n !== ids.length) throw forbidden("You can only act on your own members");
}

export const clientIp = (request) =>
  (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "";
