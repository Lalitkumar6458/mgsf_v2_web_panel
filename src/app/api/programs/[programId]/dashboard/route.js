import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { programDashboard } from "@/services/reports.js";

export const GET = route(async ({ auth, params }) => {
  await getProgramFor(auth, params.programId);
  return programDashboard(params.programId, { agentId: auth.role === "agent" ? auth.agentId : undefined });
});
