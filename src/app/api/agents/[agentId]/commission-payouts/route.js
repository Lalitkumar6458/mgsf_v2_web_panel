import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { forbidden } from "@/lib/errors.js";
import { listPayouts, createPayout } from "@/services/commissions.js";

export const GET = route(async ({ auth, params }) => {
  if (auth.role === "member" || (auth.role === "agent" && auth.agentId !== params.agentId)) throw forbidden();
  return { payouts: await listPayouts(auth.adminId, params.agentId) };
});

/** POST { mode: selected|all|upto, commissionIds?, upto?, filters?, paymentMode, reference, note, payoutDate } */
export const POST = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  return createPayout(auth.adminId, params.agentId, await readJson(request), auth);
});
