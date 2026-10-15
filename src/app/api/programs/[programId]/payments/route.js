import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { assertAgentMembers } from "@/lib/access.js";
import { badRequest, forbidden } from "@/lib/errors.js";
import { paySingle, payBulk } from "@/services/payments.js";

/** POST { type: "single" | "bulk", … } — see services/payments.js */
export const POST = route(async ({ request, auth, params }) => {
  await getProgramFor(auth, params.programId);
  if (auth.role === "member") throw forbidden();
  const body = { ...(await readJson(request)), programId: params.programId };
  if (body.type === "single") {
    await assertAgentMembers(auth, params.programId, [body.payerId]);
    return paySingle(body, auth);
  }
  if (body.type === "bulk") {
    await assertAgentMembers(auth, params.programId, body.memberIds || []);
    return payBulk(body, auth);
  }
  throw badRequest('type must be "single" or "bulk"');
});
