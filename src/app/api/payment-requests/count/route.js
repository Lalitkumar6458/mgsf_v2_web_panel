// Panel menu badge: how many app payment requests wait for the office.
import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { pendingCount } from "@/services/paymentRequests.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth }) => { adminOnly(auth); return { pending: await pendingCount(auth.adminId) }; });
