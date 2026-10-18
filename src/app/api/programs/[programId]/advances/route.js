// Members of a yojna who have advance (अग्रिम) money — agents see only their members.
import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { forbidden } from "@/lib/errors.js";
import { programAdvances } from "@/services/advances.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, params }) => {
  await getProgramFor(auth, params.programId);
  if (auth.role === "member") throw forbidden();
  return programAdvances(params.programId, { agentId: auth.role === "agent" ? auth.agentId : undefined });
});
