// Panel: one app payment request.
//   GET  → request + every member / due in it as it is today (+ duplicate UTR warning)
//   POST { action: "approve", amount?, paymentDate?, reference?, method?, items?, extraToAdvance?, note? }
//   POST { action: "reject", reason }
// Approve writes a normal payment (dues paid, receipt) → push + WhatsApp paid rasid like any payment.
import { route, readJson } from "@/lib/http.js";
import { adminOnly, publicOrigin } from "@/lib/access.js";
import { badRequest } from "@/lib/errors.js";
import { later, notify } from "@/lib/push.js";
import { notifyPayment } from "@/services/autoNotify.js";
import { onPayment } from "@/services/whatsapp.js";
import { requestDetail, approveRequest, rejectRequest } from "@/services/paymentRequests.js";

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth, params }) => {
  adminOnly(auth);
  return requestDetail(auth.adminId, params.id);
});
export const POST = route(async ({ auth, params, request }) => {
  adminOnly(auth);
  const body = await readJson(request);
  if (body.action === "approve") {
    const r = await approveRequest(auth.adminId, params.id, body, auth);
    const base = publicOrigin(request);
    for (const b of r.batches) {
      later(() => notifyPayment(auth.adminId, b.batchId));
      later(() => onPayment(auth.adminId, b.batchId, base));
    }
    // the member (and family) get "भुगतान जमा हुआ" from notifyPayment; an agent who sent it gets this
    if (r.accountId && r.requestedByRole === "agent") later(() => notify(auth.adminId, [r.accountId], {
      title: "भुगतान अनुरोध स्वीकार ✅", body: `${r.requestNo}: ${inr(r.receivedAmount)} जमा हो गया। रसीद ऐप में देखें।`, data: { type: "paymentRequest", status: "approved" },
    }));
    return r;
  }
  if (body.action === "reject") {
    const r = await rejectRequest(auth.adminId, params.id, body, auth);
    const msg = { title: "भुगतान अनुरोध अस्वीकार", body: `${r.requestNo} (${inr(r.amount)}): ${body.reason}`, data: { type: "paymentRequest", status: "rejected" } };
    if (r.accountId) later(() => notify(auth.adminId, [r.accountId], msg));
    return r;
  }
  throw badRequest('action: "approve" | "reject"');
});
