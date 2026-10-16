// Agent cash hisaab. GET → summary of every agent (?agentId= → that agent's day-wise ledger);
// POST { agentId, amount, handedOn, mode, note } → agent handed cash to the trust.
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { forbidden } from "@/lib/errors.js";
import { cashSummary, agentLedger, addHandover } from "@/services/cashHandover.js";

export const GET = route(async ({ auth, params, query }) => {
  const program = await getProgramFor(auth, params.programId);
  const adminId = program.adminId;
  // an agent only ever sees his own hisaab
  const agentId = auth.role === "agent" ? auth.agentId : query.get("agentId");
  if (agentId) return agentLedger(adminId, params.programId, agentId);
  if (auth.role === "agent") throw forbidden();
  return cashSummary(adminId, params.programId, { today: query.get("today") });
});

export const POST = route(async ({ request, auth, params }) => {
  if (auth.role === "agent" || auth.role === "member") throw forbidden("Jama sirf office se darj hota hai");
  const program = await getProgramFor(auth, params.programId);
  return { success: true, handover: await addHandover(program.adminId, params.programId, await readJson(request), auth) };
});
