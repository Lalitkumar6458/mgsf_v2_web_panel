import { route } from "@/lib/http.js";
import { forbidden } from "@/lib/errors.js";
import { listCommissions, commissionSummary } from "@/services/commissions.js";

/**
 * Commission history of one agent (admin, or the agent himself — read only).
 * GET ?programId&source=join_fees|closing&status=pending|paid|cancelled&from&to&q&payoutId&page&pageSize&all=1
 */
export const GET = route(async ({ auth, params, query }) => {
  if (auth.role === "member" || (auth.role === "agent" && auth.agentId !== params.agentId)) throw forbidden();
  const f = Object.fromEntries(["programId", "source", "status", "from", "to", "q", "payoutId", "page", "pageSize"]
    .map((k) => [k, query.get(k) || undefined]));
  f.all = query.get("all") === "1";
  const [list, summary] = await Promise.all([
    listCommissions(auth.adminId, params.agentId, f),
    commissionSummary(auth.adminId, params.agentId, { programId: f.programId }),
  ]);
  return { ...list, summary };
});
