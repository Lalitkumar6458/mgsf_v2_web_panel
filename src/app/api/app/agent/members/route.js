// Agent app: his members with dues. ?programId=&f=all|due|paid|feeDue|feeDone|active|closed|blocked&q=&page=&limit=
import { route } from "@/lib/http.js";
import { agentMembers } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, query }) => agentMembers(auth, Object.fromEntries(query.entries())));
