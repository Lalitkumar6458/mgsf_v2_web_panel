import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { forbidden } from "@/lib/errors.js";
import { agentReport } from "@/services/reports.js";

/** Old getAgentMarriagePaymentReport. GET ?closingGroupId=&compact=1 */
export const GET = route(async ({ auth, params, query }) => {
  await getProgramFor(auth, params.programId);
  if (auth.role === "member" || (auth.role === "agent" && auth.agentId !== params.agentId)) throw forbidden();
  return agentReport(params.programId, params.agentId, {
    closingGroupId: query.get("closingGroupId") || undefined,
    compact: query.get("compact") !== "0",
  });
});
