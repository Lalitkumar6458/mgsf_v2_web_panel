import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { agentsCommissionTotals } from "@/services/commissions.js";

/** GET ?programId= — earned / paid / pending per agent (agents list) */
export const GET = route(async ({ auth, query }) => {
  adminOnly(auth);
  return { totals: await agentsCommissionTotals(auth.adminId, { programId: query.get("programId") || undefined }) };
});
