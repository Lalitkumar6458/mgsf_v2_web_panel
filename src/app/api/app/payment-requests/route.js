// App: "भुगतान का अनुरोध" — member / agent paid the trust (UPI QR / bank) and sends UTR + screenshot.
//   GET  → my requests (status, reason if rejected)
//   POST { items:[{memberId, dueIds, joinFee}], amount, method, reference, paymentDate, screenshotUrl, note }
import { route, readJson } from "@/lib/http.js";
import { createRequest, myRequests } from "@/services/paymentRequests.js";
import { later, notify } from "@/lib/push.js";
import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ auth }) => myRequests(auth));
export const POST = route(async ({ auth, request }) => {
  const r = await createRequest(auth, await readJson(request));
  // tell the office logins (admin panel users with the app installed rarely — the panel shows a badge too)
  later(async () => {
    const { rows } = await db.execute(sql`SELECT id FROM accounts WHERE admin_id = ${auth.adminId} AND role = 'admin' AND active`);
    if (rows.length) await notify(auth.adminId, rows.map((x) => x.id), { title: "नया भुगतान अनुरोध", body: `${auth.displayName || ""}: ₹${r.request.amount} · UTR ${r.request.reference}`, data: { type: "paymentRequest", id: r.request.id } });
  });
  return r;
});
