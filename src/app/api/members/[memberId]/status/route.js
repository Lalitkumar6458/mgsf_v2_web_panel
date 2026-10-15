import { route, readJson } from "@/lib/http.js";
import { getMemberFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { setMemberStatus, setBlocked } from "@/services/members.js";
import { notifyAgent } from "@/lib/push.js";

/** POST { status: "rejected" | "removed", reason } or { blocked: true|false } */
export const POST = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  const m = await getMemberFor(auth, params.memberId, { forWrite: true });
  const body = await readJson(request);
  if (body.blocked !== undefined) return setBlocked(params.memberId, body.blocked);
  const r = await setMemberStatus(params.memberId, body.status, { reason: body.reason });
  if (body.status === "rejected" && m.agentId) {
    notifyAgent(m.program.adminId, m.agentId, {
      title: "Member Rejected",
      body: `Rejected ${m.displayName}'s request.${body.reason ? ` Reason: ${body.reason}` : ""}`,
      data: { memberId: m.id },
    }).catch(() => {});
  }
  return r;
});
