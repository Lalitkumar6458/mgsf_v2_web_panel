import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { programAnalytics } from "@/services/analytics.js";

/** Advanced dashboard. ?agentId= narrows to one agent (an agent always sees only his own). */
export const GET = route(async ({ auth, params, request }) => {
  await getProgramFor(auth, params.programId);
  const q = new URL(request.url).searchParams;
  const agentId = auth.role === "agent" ? auth.agentId : (q.get("agentId") || undefined);
  const out = await programAnalytics(params.programId, { agentId });
  // feature lock: count display switched off → show the real count
  if (auth.features?.countDisplay === false && out?.members && "display" in out.members) {
    out.members.display = out.members.onBooks;
    out.members.countDisplay = { mode: "actual" };
  }
  return out;
});
