import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth.js";
import { assertApiAccess } from "@/lib/apiAccess.js";
import { getTrustProfile } from "@/services/trust.js";
import { renderToBuffer } from "@react-pdf/renderer";
import VivahMemoPDF from "@/components/screen/agents/agentDetails/component/pdfcom/VivahMemoPDF";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function POST(req) {
  // login required (cookie for the panel, Bearer token for the app)
  let auth;
  try { auth = await getAuth(req); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders }); }
  try { assertApiAccess(auth, req); } catch (e) { return NextResponse.json({ error: e.message }, { status: 403, headers: corsHeaders }); }
  try {
    const {
      data,
      summary,
      agentInfo,
      programInfo,
      filters,
      paymentStatus = "pending", // 'pending' | 'paid'
      receiptStartNo = 1,        // रसीद न. serial start
      receiptPrefix = "",        // optional रसीद न. prefix
    } = await req.json();

    const status = paymentStatus === "paid" ? "paid" : "pending";

    const pdfBuffer = await renderToBuffer(
      <VivahMemoPDF
        members={data}
        agentInfo={agentInfo}
        programInfo={programInfo}
        TrustData={await getTrustProfile(auth.adminId)}
        paymentStatus={status}
        receiptStartNo={receiptStartNo}
        receiptPrefix={receiptPrefix}
      />
    );

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${status}-receipts.pdf"`,
      },
    });
  } catch (error) {
    console.error("PDF generation error:", error);

    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500, headers: corsHeaders }
    );
  }
}