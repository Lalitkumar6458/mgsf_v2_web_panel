import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { revertPayout } from "@/services/commissions.js";

/** POST { reason } — undo a payout; its entries become pending again */
export const POST = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  const { reason = "" } = await readJson(request);
  return revertPayout(auth.adminId, params.payoutId, { reason });
});
