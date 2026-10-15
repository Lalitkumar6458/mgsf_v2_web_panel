import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { notFound } from "@/lib/errors.js";
import { deleteJoinFeePayment } from "@/services/joinFees.js";

/** Delete a wrong join fee entry (member totals are recalculated) */
export const DELETE = route(async ({ auth, params }) => {
  adminOnly(auth);
  const { rows: [p] } = await db.execute(sql`SELECT program_id FROM join_fee_payments WHERE id = ${params.paymentId}`);
  if (!p) throw notFound("Payment not found");
  await getProgramFor(auth, p.program_id);
  return deleteJoinFeePayment(params.paymentId);
});
