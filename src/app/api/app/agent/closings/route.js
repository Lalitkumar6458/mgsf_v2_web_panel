// Agent app: every closing + closing groups, counted over his members only.
import { route } from "@/lib/http.js";
import { agentClosings } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, query }) => agentClosings(auth, { programId: query.get("programId") }));
