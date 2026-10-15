import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { badRequest, forbidden } from "@/lib/errors.js";
import { agentPaymentStatus } from "@/services/reports.js";

// Agent → All Payment Status (same request/response as the old Firestore route)
async function handle(auth, { agentId, programId, groupId }) {
  if (!agentId || !programId) throw badRequest("agentId and programId are required");
  await getProgramFor(auth, programId);
  if (auth.role === "member" || (auth.role === "agent" && auth.agentId !== agentId)) throw forbidden();
  return agentPaymentStatus(programId, agentId, { groupId: groupId || undefined });
}

export const GET = route(async ({ auth, query }) =>
  handle(auth, { agentId: query.get("agentId"), programId: query.get("programId"), groupId: query.get("groupId") }));

export const POST = route(async ({ request, auth }) => handle(auth, await readJson(request)));
