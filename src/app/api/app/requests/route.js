// Agent app: his "new member" requests (pending / approved / rejected + reason).
// New requests are sent with POST /api/programs/:id/members (same as the panel).
import { route } from "@/lib/http.js";
import { agentRequests } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth }) => agentRequests(auth));
