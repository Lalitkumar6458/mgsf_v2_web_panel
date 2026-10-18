// Fixed rakam (seema) for many members at once — Members page → select → "Fixed rakam".
//   POST { memberIds, fixedLimit (₹, null/0 = remove), advance?: { method: "cash", paymentDate, note } }
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { badRequest } from "@/lib/errors.js";
import { setFixedLimit } from "@/services/fixedLimit.js";

export const dynamic = "force-dynamic";
export const POST = route(async ({ auth, params, request }) => {
  adminOnly(auth);
  await getProgramFor(auth, params.programId, { forWrite: true });
  const body = await readJson(request);
  if (body.advance && auth.features?.advancePayment === false) throw badRequest("Advance payment is panel mein chalu nahi hai");
  return setFixedLimit(params.programId, body, auth);
});
