import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { accruePast } from "@/services/commissions.js";

/** POST { programId?, from?, to?, sources?: ["join_fees","closing"] } — commission for older payments at current rates */
export const POST = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  const b = await readJson(request);
  return accruePast(auth.adminId, params.agentId, {
    programId: b.programId || undefined, from: b.from || undefined, to: b.to || undefined,
    sources: Array.isArray(b.sources) && b.sources.length ? b.sources : undefined,
  });
});
