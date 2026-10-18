// Mobile app: one member's whole account (closings + timing, receipts, joining fee, totals).
// Agent: own members · member: himself + family.
import { route } from "@/lib/http.js";
import { memberFor, memberDetail } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, params }) => {
  const m = await memberFor(auth, params.id);
  return memberDetail(m.id, m);
});
