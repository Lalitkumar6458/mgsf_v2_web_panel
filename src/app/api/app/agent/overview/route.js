// Agent app home: his members' money, joining fees, commission, requests, yojna list (+ rules).
import { route } from "@/lib/http.js";
import { agentOverview } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, query }) => agentOverview(auth, query.get("programId")));
