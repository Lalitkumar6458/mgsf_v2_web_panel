// Agent app: commission entries, payouts and totals.
import { route } from "@/lib/http.js";
import { agentCommission } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, query }) => agentCommission(auth, { programId: query.get("programId") || undefined }));
