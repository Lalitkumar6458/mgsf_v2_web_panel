import { route, readJson } from "@/lib/http.js";
import { getMemberFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { payerDuesCheck, applyPayerCorrection } from "@/services/closings.js";

/** "Correct Payments": GET = compare with the rule, POST { addClosingIds, removeDueIds } = apply */
export const GET = route(async ({ auth, params }) => {
  adminOnly(auth);
  await getMemberFor(auth, params.memberId);
  return payerDuesCheck(params.memberId);
});

export const POST = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  await getMemberFor(auth, params.memberId, { forWrite: true });
  return applyPayerCorrection(params.memberId, await readJson(request));
});
