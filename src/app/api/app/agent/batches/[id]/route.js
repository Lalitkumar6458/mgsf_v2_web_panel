// Agent app: one closing group — its closings and his members' dues across the whole group.
import { route } from "@/lib/http.js";
import { agentBatch } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, params }) => agentBatch(auth, params.id));
