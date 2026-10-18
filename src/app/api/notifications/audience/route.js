// GET ?to=&programId=&memberIds=a,b — how many logins / phones a send would reach
import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { audience } from "@/services/notifySend.js";

export const GET = route(async ({ auth, query }) => {
  adminOnly(auth);
  const list = (k) => String(query.get(k) || "").split(",").filter(Boolean);
  return audience(auth.adminId, { to: query.get("to"), programId: query.get("programId"), memberIds: list("memberIds"), agentIds: list("agentIds") });
});
