import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { programAnalytics } from "@/services/analytics.js";

/** Advanced dashboard. ?agentId= narrows to one agent (an agent always sees only his own). */
export const GET = route(async ({ auth, params, request }) => {
  await getProgramFor(auth, params.programId);
  const q = new URL(request.url).searchParams;
  const agentId = auth.role === "agent" ? auth.agentId : (q.get("agentId") || undefined);
  return programAnalytics(params.programId, { agentId });
});
