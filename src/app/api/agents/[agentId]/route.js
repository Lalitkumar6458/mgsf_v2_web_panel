import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { forbidden } from "@/lib/errors.js";
import { getAgent, updateAgent, deleteAgent } from "@/services/agents.js";

export const GET = route(async ({ auth, params }) => {
  if (auth.role === "agent" && auth.agentId !== params.agentId) throw forbidden();
  if (auth.role === "member") throw forbidden();
  return { agent: await getAgent(auth.adminId, params.agentId) };
});

/** PATCH { …fields, password?, active? } */
export const PATCH = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  return { success: true, agent: await updateAgent(auth.adminId, params.agentId, await readJson(request)) };
});

/** DELETE ?moveMembersTo=<agentId> */
export const DELETE = route(async ({ auth, params, query }) => {
  adminOnly(auth);
  return deleteAgent(auth.adminId, params.agentId, { moveMembersTo: query.get("moveMembersTo") || undefined });
});
