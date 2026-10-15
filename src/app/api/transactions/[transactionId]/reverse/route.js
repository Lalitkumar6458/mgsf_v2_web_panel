import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { notFound } from "@/lib/errors.js";
import { reverseTransaction } from "@/services/payments.js";

/** POST { reason } — undo a wrong payment entry (admin only) */
export const POST = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  const { rows: [t] } = await db.execute(sql`SELECT program_id FROM transactions WHERE id = ${params.transactionId}`);
  if (!t) throw notFound("Transaction not found");
  await getProgramFor(auth, t.program_id);
  const { reason } = await readJson(request);
  return reverseTransaction(params.transactionId, { reason }, auth);
});
