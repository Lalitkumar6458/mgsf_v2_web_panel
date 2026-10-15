import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth.js";
import { assertApiAccess } from "@/lib/apiAccess.js";
import { getTrustProfile } from "@/services/trust.js";
import CertificateServerSide from "@/components/pdfcom/Certificates/CertificateComServerSide";
import TemplateCertificatePdf from "@/components/pdfcom/Certificates/TemplateCertificatePdf";
import { getActiveTemplate } from "@/services/certificateTemplates.js";
import { resolveCertificateImages } from "@/lib/certificateImages.js";
import { renderToBuffer } from "@react-pdf/renderer";

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
    const { memberData, selectedProgram } = await req.json();

    // the trust's own design (Certificate Builder) if it has one for this yojna, else the built-in one
    const template = await getActiveTemplate(auth.adminId, selectedProgram?.id || memberData?.programId || null)
      .catch((e) => { console.error("[certificate] template lookup failed", e); return null; });

    let buffer;
    if (template && (template.frameImg || template.elements?.length)) {
      const ready = await resolveCertificateImages(template, [memberData]);
      buffer = await renderToBuffer(
        <TemplateCertificatePdf template={ready.template} members={ready.members} program={selectedProgram} trust={await getTrustProfile(auth.adminId)}
          title={`${memberData?.displayName || ""} — सदस्यता प्रमाण पत्र`} />
      );
    } else {
      buffer = await renderToBuffer(
        <CertificateServerSide
          data={memberData}
          selectedProgram={selectedProgram}
          TrustData={await getTrustProfile(auth.adminId)}
        />
      );
    }

    // 🔍 Debug (optional)
    console.log("PDF buffer size:", buffer.length);

    return NextResponse.json(
      {
        base64: buffer.toString("base64"),
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error) {
    console.error("PDF generation error:", error);

    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500, headers: corsHeaders }
    );
  }
}
