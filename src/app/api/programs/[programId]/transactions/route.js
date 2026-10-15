import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { listTransactions } from "@/services/payments.js";

/** GET ?agentId=&payerId=&closingId=&from=&to=&q=&status=completed|reversed&page=&pageSize=  (&all=1 → no paging) */
export const GET = route(async ({ auth, params, query }) => {
  await getProgramFor(auth, params.programId);
  const opts = Object.fromEntries(query.entries());
  if (opts.status === "all") opts.status = "";
  opts.all = opts.all === "1" || opts.all === "true";   // whole list in one go (capped at 50,000)
  if (auth.role === "agent") opts.agentId = auth.agentId;
  if (auth.role === "member") opts.payerId = auth.memberId;
  return listTransactions(params.programId, opts);
});
