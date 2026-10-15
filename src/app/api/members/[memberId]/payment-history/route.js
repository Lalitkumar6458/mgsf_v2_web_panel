import { route } from "@/lib/http.js";
import { getMemberFor } from "@/lib/auth.js";
import { memberPaymentHistory } from "@/services/lateReports.js";

/** Every closing this member owes / owed: due date, paid date, days late, payments */
export const GET = route(async ({ auth, params }) => {
  await getMemberFor(auth, params.memberId); // admin of the trust, his agent, or the member himself
  return memberPaymentHistory(params.memberId);
});
