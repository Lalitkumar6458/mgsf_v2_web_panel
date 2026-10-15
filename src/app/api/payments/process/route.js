import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { assertAgentMembers } from "@/lib/access.js";
import { badRequest, conflict, forbidden } from "@/lib/errors.js";
import { paySingle, payBulk } from "@/services/payments.js";

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
    return paySingle(body, auth);
  }
  if (body.type === "bulk") {
    await assertAgentMembers(auth, body.programId, body.memberIds || []);
    return payBulk(body, auth);
  }
  throw badRequest('Invalid type. Use "single" or "bulk"');
});
