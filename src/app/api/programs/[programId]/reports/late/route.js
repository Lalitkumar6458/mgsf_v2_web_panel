import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { forbidden } from "@/lib/errors.js";
import { latePayments } from "@/services/lateReports.js";

/** GET ?kind=late|overdue|on_time|not_due|problem|all &agentId &closingId &closingGroupId &from &to &q &minDays &sort &page &pageSize &all=1 */
export const GET = route(async ({ auth, params, query }) => {
  if (auth.role === "member") throw forbidden();
  await getProgramFor(auth, params.programId);
  const f = Object.fromEntries(["kind", "agentId", "closingId", "closingGroupId", "from", "to", "q", "minDays", "sort", "page", "pageSize", "limit"]
    .map((k) => [k, query.get(k) || undefined]));
  if (auth.role === "agent") f.agentId = auth.agentId; // an agent sees only his own members
  f.all = query.get("all") === "1";
  return latePayments(params.programId, f);
});
