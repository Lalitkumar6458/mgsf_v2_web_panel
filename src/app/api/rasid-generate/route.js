// One-off receipts (रसीद) for members the screen already has — e.g. Agent → Members Pay Status,
// "Pending 3 / Paid 5" buttons, and the mobile app. Big runs use POST /api/programs/:id/receipts
// (background job) instead. Same pdfkit engine and Settings → Rasid design (lib/pdf/receipts.js).
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth.js";
import { assertApiAccess } from "@/lib/apiAccess.js";
import { publicOrigin } from "@/lib/access.js";
import { getTrustProfile } from "@/services/trust.js";
import { renderPdf, registerReceipts } from "@/services/receiptJobs.js";
import { receiptSettingsForPdf } from "@/services/receiptSettings.js";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(req) {
  // login required (cookie for the panel, Bearer token for the app)
  let auth;
  try { auth = await getAuth(req); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders }); }
  try { assertApiAccess(auth, req); } catch (e) { return NextResponse.json({ error: e.message }, { status: 403, headers: corsHeaders }); }
  try {
    const { data, agentInfo, programInfo, paymentStatus = "pending", receiptStartNo = 1, receiptPrefix = "" } = await req.json();
    const status = paymentStatus === "paid" ? "paid" : "pending";
    const members = (Array.isArray(data) ? data : []).slice(0, 5000).map((m) => ({
      ...m,
      memberId: m.memberId || m.id,
      marriages: (m.marriages || []).map((x) => ({ ...x, paymentId: x.paymentId || x.id })),
    }));
    const start = Math.max(1, Math.floor(Number(receiptStartNo) || 1));
    const prefix = String(receiptPrefix || "").slice(0, 12);
    const settings = await receiptSettingsForPdf(auth.adminId, auth.features);
    const codes = status === "paid" && programInfo?.id && settings.showVerifyQr
      ? await registerReceipts({ adminId: auth.adminId, programId: programInfo.id, members, start, prefix, by: auth.accountId }).catch(() => ({}))
      : {};
    const pdf = await renderPdf({
      members, agentInfo, programInfo, paymentStatus: status, receiptStartNo: start, receiptPrefix: prefix,
      TrustData: await getTrustProfile(auth.adminId), settings, verify: { baseUrl: publicOrigin(req), codes },
    }, "receipts");
    return new NextResponse(pdf, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${status}-receipts.pdf"` },
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500, headers: corsHeaders });
  }
}
