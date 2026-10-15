import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { listAgents, createAgent } from "@/services/agents.js";

/** GET ?programId= (member counts per program) */
export const GET = route(async ({ auth, query }) => {
  adminOnly(auth);
  return { agents: await listAgents(auth.adminId, { programId: query.get("programId") || undefined, includeDeleted: query.get("includeDeleted") === "1" }) };
});

/** POST { displayName, email, password, phone, … } */
export const POST = route(async ({ request, auth }) => {
  adminOnly(auth);
  return { success: true, agent: await createAgent(auth.adminId, await readJson(request)) };
});
