// Activity log (Settings → Activity log): GET ?q=&entity=&action=&accountId=&from=&to=&page=&pageSize=
import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { listAudit, AUDIT_ENTITIES, AUDIT_ACTIONS } from "@/services/audit.js";

export const GET = route(async ({ auth, query }) => {
  adminOnly(auth);
  const out = await listAudit(auth.adminId, Object.fromEntries(query.entries()));
  return { ...out, entities: AUDIT_ENTITIES, actions: AUDIT_ACTIONS };
});
