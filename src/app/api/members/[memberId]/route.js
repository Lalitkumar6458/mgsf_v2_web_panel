import { route, readJson } from "@/lib/http.js";
import { getMemberFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { updateMember, softDeleteMember } from "@/services/members.js";

export const GET = route(async ({ auth, params }) => {
  const m = await getMemberFor(auth, params.memberId);
  delete m.program;
  return { member: m };
});

/** Admin edits any field; agent may edit his own members' details (not agent assignment) */
export const PATCH = route(async ({ request, auth, params }) => {
  const m = await getMemberFor(auth, params.memberId, { forWrite: true });
  const body = await readJson(request);
  if (auth.role === "agent") {
    delete body.agentId; delete body.selectedAgent; delete body.payAmount;
    // money entries (and so his own commission) are recorded by the admin only
    delete body.joinFeesPaidAmount; delete body.joinFeesRemainingAmount; delete body.joinFeesDone;
  }
  return updateMember(m, body);
});

export const DELETE = route(async ({ auth, params }) => {
  adminOnly(auth);
  await getMemberFor(auth, params.memberId, { forWrite: true });
  return softDeleteMember(params.memberId);
});
