import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth.js";
import { assertApiAccess } from "@/lib/apiAccess.js";
import { getTrustProfile } from "@/services/trust.js";
import { renderToBuffer } from "@react-pdf/renderer";
import PaymentStatusPDF from "@/components/screen/agents/agentDetails/component/pdfcom/PaymentReportPDF";
import AllPaymentPdf from "@/components/screen/agents/agentDetails/component/AllPaymentStatus/AllPaymentPdf";

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
    const { rowData, agentInfo, paymentStatus = "all" } = await req.json();

    const mode = ["pending", "paid", "closed", "closed_paid", "closed_pending"].includes(paymentStatus)
      ? paymentStatus
      : "all";

    const pdfBuffer = await renderToBuffer(
      <AllPaymentPdf
        rowData={rowData}
        agentInfo={agentInfo}
        TrustData={await getTrustProfile(auth.adminId)}
        paymentStatus={mode}
        fileName={`all-payment-status-${mode}.pdf`}
      />
    );

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="payment-report-${mode}.pdf"`,
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