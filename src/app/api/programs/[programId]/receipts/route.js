import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { getTrustProfile } from "@/services/trust.js";
import { createReceiptJob } from "@/services/receiptJobs.js";

export const runtime = "nodejs";

/**
 * Start a receipts (रसीद) PDF run. Body: { status: "pending"|"paid", agentId?, closingGroupId?,
 * from?, to? (closing date, YYYY-MM-DD), memberIds?, receiptStartNo?, receiptPrefix?, label? }
 * → job (poll GET /api/receipts/jobs/:id; download each part when done)
 */
export const POST = route(async ({ request, auth, params }) => {
  const program = await getProgramFor(auth, params.programId);
  const b = await readJson(request);
  const agentId = auth.role === "agent" ? auth.agentId : (b.agentId || undefined);
  const day = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : undefined);
  const agentInfo = b.agentInfo && typeof b.agentInfo === "object" ? { displayName: String(b.agentInfo.displayName || ""), phone: String(b.agentInfo.phone || "") } : {};
  const job = await createReceiptJob(params.programId, auth.adminId, await getTrustProfile(auth.adminId), {
    status: b.status,
    agentId,
    closingGroupId: b.closingGroupId || undefined,
    from: day(b.from),
    to: day(b.to),
    memberIds: Array.isArray(b.memberIds) ? b.memberIds : undefined,
    receiptStartNo: b.receiptStartNo,
    receiptPrefix: typeof b.receiptPrefix === "string" ? b.receiptPrefix.slice(0, 12) : "",
    label: typeof b.label === "string" ? b.label.slice(0, 120) : undefined,
    agentInfo,
    programInfo: { id: program?.id, name: program?.name, hiname: program?.hiname || program?.extra?.hiname || program?.name, isMamera: !!(program?.isMamera ?? program?.extra?.isMamera) },
  });
  return { success: true, job };
});
