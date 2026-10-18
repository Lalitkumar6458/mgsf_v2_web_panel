import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { assertAgentMembers } from "@/lib/access.js";
import { badRequest, conflict, forbidden } from "@/lib/errors.js";
import { paySingle, payBulk } from "@/services/payments.js";
import { publicOrigin } from "@/lib/access.js";
import { later } from "@/lib/push.js";
import { notifyPayment } from "@/services/autoNotify.js";
import { onPayment } from "@/services/whatsapp.js";

// after a payment: app push + WhatsApp paid rasid (never slows or fails the payment)
const after = (auth, request, r) => {
  if (r?.batchId) {
    const base = publicOrigin(request);
    later(() => notifyPayment(auth.adminId, r.batchId));
    later(() => onPayment(auth.adminId, r.batchId, base));
  }
  return r;
};

/** Old route kept for the Closing Payments page: POST { type: "single" | "bulk", programId, … } */
export const POST = route(async ({ request, auth }) => {
  const body = await readJson(request);
  await getProgramFor(auth, body.programId);
  if (auth.role === "member") throw forbidden();

  // duplicate-reference check only
  if (body._checkOnly) {
    const ref = String(body.onlineReference || "").trim();
    const { rows } = await db.execute(sql`
      SELECT 1 FROM transactions WHERE program_id = ${body.programId} AND status = 'completed'
        AND (online_reference = ${ref} OR transaction_number = ${ref}) LIMIT 1`);
    if (ref && rows.length) throw conflict("Duplicate reference number");
    return { success: true };
  }
  if (body.type === "single") {
    await assertAgentMembers(auth, body.programId, [body.payerId]);
    return after(auth, request, await paySingle(body, auth));
  }
  if (body.type === "bulk") {
    await assertAgentMembers(auth, body.programId, body.memberIds || []);
    return after(auth, request, await payBulk(body, auth));
  }
  throw badRequest('Invalid type. Use "single" or "bulk"');
});
