// Mobile app: a member's सदस्यता प्रमाण पत्र as PDF (GET + Bearer). Same designs as the panel:
// the trust's Certificate Builder template for this yojna if it has one, else the built-in one.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { renderToBuffer } from "@react-pdf/renderer";
import { db, schema } from "@/db/index.js";
import { route } from "@/lib/http.js";
import { forbidden } from "@/lib/errors.js";
import { publicOrigin } from "@/lib/access.js";
import { getTrustProfile } from "@/services/trust.js";
import { getActiveTemplate } from "@/services/certificateTemplates.js";
import { resolveCertificateImages } from "@/lib/certificateImages.js";
import { certificateCode } from "@/services/verify.js";
import { memberFor } from "@/services/mobileApp.js";
import CertificateServerSide from "@/components/pdfcom/Certificates/CertificateComServerSide";
import TemplateCertificatePdf from "@/components/pdfcom/Certificates/TemplateCertificatePdf";

export const runtime = "nodejs";

export const GET = route(async ({ auth, params, request }) => {
  if (auth.features?.certificates === false) throw forbidden("प्रमाण पत्र अभी बंद है");
  const m = await memberFor(auth, params.id);
  if (!["accepted", "closed"].includes(m.status)) throw forbidden("सदस्य स्वीकार होने के बाद प्रमाण पत्र बनेगा");
  const member = await db.query.members.findFirst({ where: eq(schema.members.id, m.id) });
  const program = { id: m.program_id, name: m.program_name, hiname: m.program_hiname };
  const trust = await getTrustProfile(auth.adminId);
  const template = await getActiveTemplate(auth.adminId, m.program_id).catch(() => null);
  let buffer;
  if (template && (template.frameImg || template.elements?.length)) {
    const wantQr = auth.features?.verifyQr !== false && template.elements?.some((e) => e.fieldKey === "verifyQr" && !e.hidden);
    const data = wantQr
      ? { ...member, verifyQr: await QRCode.toDataURL(`${publicOrigin(request)}/verify/c/${encodeURIComponent(certificateCode(member.id))}`, { errorCorrectionLevel: "M", margin: 1, width: 300 }) }
      : member;
    const ready = await resolveCertificateImages(template, [data]);
    buffer = await renderToBuffer(
      <TemplateCertificatePdf template={ready.template} members={ready.members} program={program} trust={trust} title={`${member.displayName || ""} — सदस्यता प्रमाण पत्र`} />,
    );
  } else {
    buffer = await renderToBuffer(<CertificateServerSide data={member} selectedProgram={program} TrustData={trust} />);
  }
  return new NextResponse(buffer, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="certificate-${member.registrationNumber || member.id}.pdf"`, "Cache-Control": "no-store" },
  });
});
