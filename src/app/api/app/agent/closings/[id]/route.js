// Agent app: one closing — which of his members paid, who still owes.
import { route } from "@/lib/http.js";
import { agentClosing } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, params }) => agentClosing(auth, params.id));
