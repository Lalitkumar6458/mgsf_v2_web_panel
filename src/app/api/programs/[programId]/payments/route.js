import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { assertAgentMembers, publicOrigin } from "@/lib/access.js";
import { onPayment } from "@/services/whatsapp.js";
import { badRequest, forbidden } from "@/lib/errors.js";
import { paySingle, payBulk } from "@/services/payments.js";
import { later } from "@/lib/push.js";
import { notifyPayment } from "@/services/autoNotify.js";

/** POST { type: "single" | "bulk", … } — see services/payments.js */
export const POST = route(async ({ request, auth, params }) => {
  await getProgramFor(auth, params.programId);
  if (auth.role === "member") throw forbidden();
  const body = { ...(await readJson(request)), programId: params.programId };
  if (body.type === "single") {
    await assertAgentMembers(auth, params.programId, [body.payerId]);
    const r = await paySingle(body, auth);
    later(() => notifyPayment(auth.adminId, r.batchId));
    later(() => onPayment(auth.adminId, r.batchId, publicOrigin(request)));
    return r;
  }
  if (body.type === "bulk") {
    await assertAgentMembers(auth, params.programId, body.memberIds || []);
    const r = await payBulk(body, auth);
    later(() => notifyPayment(auth.adminId, r.batchId));
    later(() => onPayment(auth.adminId, r.batchId, publicOrigin(request)));
    return r;
  }
  throw badRequest('type must be "single" or "bulk"');
});
