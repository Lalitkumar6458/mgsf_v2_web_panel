// Advance (अग्रिम) of one member.
//   GET  → { balance, totals, entries }   (admin, his agent, the member himself)
//   POST { amount, method, paymentDate, reference, note }              → deposit (admin / his agent)
//   POST { action: "refund", amount, method, note }                    → money given back (admin)
import { route, readJson } from "@/lib/http.js";
import { getMemberFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { forbidden } from "@/lib/errors.js";
import { memberAdvances, addAdvance, refundAdvance } from "@/services/advances.js";
import { limitStatus } from "@/services/fixedLimit.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, params }) => {
  await getMemberFor(auth, params.memberId);
  return { ...(await memberAdvances(params.memberId)), limit: await limitStatus(params.memberId) }; // limit: fixed rakam room
});
export const POST = route(async ({ auth, params, request }) => {
  if (auth.role === "member") throw forbidden();
  await getMemberFor(auth, params.memberId, { forWrite: true });
  const body = await readJson(request);
  if (body.action === "refund") {
    adminOnly(auth);
    return refundAdvance(params.memberId, body, auth);
  }
  return addAdvance(params.memberId, body, auth);
});
