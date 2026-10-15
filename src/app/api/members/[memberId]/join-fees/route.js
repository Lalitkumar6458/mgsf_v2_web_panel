import { route } from "@/lib/http.js";
import { getMemberFor } from "@/lib/auth.js";
import { listJoinFeePayments } from "@/services/joinFees.js";

/** Join fee instalments of one member */
export const GET = route(async ({ auth, params }) => {
  await getMemberFor(auth, params.memberId);
  return { payments: await listJoinFeePayments(params.memberId) };
});
