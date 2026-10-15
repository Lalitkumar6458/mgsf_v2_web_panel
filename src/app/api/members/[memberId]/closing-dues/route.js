import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { forbidden, notFound } from "@/lib/errors.js";
import { db, schema } from "@/db/index.js";
import { eq } from "drizzle-orm";
import { closingDues } from "@/services/closings.js";

/** Payers of this member's closing. GET ?status=pending|partial|paid  (agent: only his members) */
export const GET = route(async ({ auth, params, query }) => {
  if (auth.role === "member") throw forbidden();
  const m = await db.query.members.findFirst({ where: eq(schema.members.id, params.memberId) });
  if (!m) throw notFound("Member not found");
  await getProgramFor(auth, m.programId);
  return closingDues(params.memberId, {
    agentId: auth.role === "agent" ? auth.agentId : query.get("agentId") || undefined,
    status: query.get("status") || undefined,
  });
});
