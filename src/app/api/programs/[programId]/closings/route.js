import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { listClosings } from "@/services/closings.js";

/** Closings with payment progress. GET ?closingGroupId=&from=&to=  (agent: counts only his members' dues) */
export const GET = route(async ({ auth, params, query }) => {
  await getProgramFor(auth, params.programId);
  return listClosings(params.programId, {
    agentId: auth.role === "agent" ? auth.agentId : query.get("agentId") || undefined,
    closingAgentId: query.get("closingAgentId") || undefined,
    closingGroupId: query.get("closingGroupId") || undefined,
    from: query.get("from") || undefined,
    to: query.get("to") || undefined,
  });
});
