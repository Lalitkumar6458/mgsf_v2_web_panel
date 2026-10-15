import { route } from "@/lib/http.js";
import { getMemberFor } from "@/lib/auth.js";
import { memberDues } from "@/services/reports.js";

/** What this member owes / has paid. GET ?status=pending|partial|paid */
export const GET = route(async ({ auth, params, query }) => {
  await getMemberFor(auth, params.memberId);
  return memberDues(params.memberId, { status: query.get("status") || undefined });
});
