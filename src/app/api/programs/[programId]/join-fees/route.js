import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { assertAgentMembers } from "@/lib/access.js";
import { forbidden } from "@/lib/errors.js";
import { addJoinFeePayments } from "@/services/joinFees.js";

/** POST { items: [{memberId, amount}], paymentMode, transactionId, note, paymentDate, agentId?, createdByName? } */
export const POST = route(async ({ request, auth, params }) => {
  await getProgramFor(auth, params.programId);
  if (auth.role === "member") throw forbidden();
  const body = await readJson(request);
  const items = Array.isArray(body.items) ? body.items : [];
  await assertAgentMembers(auth, params.programId, items.map((i) => i.memberId));
  if (auth.role === "agent") body.agentId = auth.agentId;
  return addJoinFeePayments(params.programId, items, body, auth);
});
