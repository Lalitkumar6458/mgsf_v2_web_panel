// Mobile app: one member's rasid (receipt) PDF — pending or paid.
// POST { memberId, status: "pending" | "paid" } → application/pdf
// Agent: only his own members. Member: only himself. Data is read from the DB here, so the app
// never has to build the receipt rows itself. Same engine + Settings → Rasid design as the panel.
import { NextResponse } from "next/server";
import { getAuth, getMemberFor } from "@/lib/auth.js";
import { assertApiAccess } from "@/lib/apiAccess.js";
import { publicOrigin } from "@/lib/access.js";
import { getTrustProfile } from "@/services/trust.js";
import { receiptMembers } from "@/services/reports.js";
import { renderPdf, registerReceipts } from "@/services/receiptJobs.js";
import { receiptSettingsForPdf } from "@/services/receiptSettings.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error, status) => NextResponse.json({ error }, { status });

export async function POST(req) {
  let auth;
  try { auth = await getAuth(req); } catch { return fail("Unauthorized", 401); }
  try { assertApiAccess(auth, req); } catch (e) { return fail(e.message, 403); }
  if (auth.features?.receipts === false) return fail("Rasid abhi band hai", 403);
  try {
    const body = await req.json().catch(() => ({}));
    const status = body.status === "paid" ? "paid" : "pending";
    const memberId = String(body.memberId || auth.memberId || "");
    if (!memberId) return fail("memberId chahiye", 400);
    let member;
    try { member = await getMemberFor(auth, memberId); } catch (e) { return fail(e.message || "Forbidden", e.status || 403); }
    const members = await receiptMembers(member.programId, { status, memberIds: [member.id] });
    if (!members.length) return fail(status === "paid" ? "Koi paid rasid nahi hai" : "Koi baki rakam nahi hai", 404);
    const settings = await receiptSettingsForPdf(auth.adminId, auth.features);
    const programInfo = { id: member.programId, name: member.program?.name || "" };
    const codes = status === "paid" && settings.showVerifyQr
      ? await registerReceipts({ adminId: auth.adminId, programId: member.programId, members, start: 1, prefix: "", by: auth.accountId }).catch(() => ({}))
      : {};
    const pdf = await renderPdf({
      members, agentInfo: {}, programInfo, paymentStatus: status, receiptStartNo: 1, receiptPrefix: "",
      TrustData: await getTrustProfile(auth.adminId), settings, verify: { baseUrl: publicOrigin(req), codes },
    }, "receipts");
    return new NextResponse(pdf, {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="rasid-${status}.pdf"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[app/receipt]", e);
    return fail("Rasid nahi ban payi", 500);
  }
}
