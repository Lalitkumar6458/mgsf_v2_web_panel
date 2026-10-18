// Panel: app payment requests. GET ?status=pending|approved|rejected|cancelled|all&q=&page=
import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { listRequests } from "@/services/paymentRequests.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, query }) => {
  adminOnly(auth);
  return listRequests(auth.adminId, { status: query.get("status") || "pending", q: query.get("q") || "", page: query.get("page") || 1 });
});
