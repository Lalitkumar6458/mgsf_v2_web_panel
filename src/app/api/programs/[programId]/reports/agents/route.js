import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { agentPerformance } from "@/services/lateReports.js";

/** GET ?from&to (closing date range) — agent ranking */
export const GET = route(async ({ auth, params, query }) => {
  adminOnly(auth);
  await getProgramFor(auth, params.programId);
  return agentPerformance(params.programId, { from: query.get("from") || undefined, to: query.get("to") || undefined });
});
