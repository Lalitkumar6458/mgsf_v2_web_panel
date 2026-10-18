// सदस्यता प्रमाण पत्र as a PDF buffer — used by the mobile app download and the WhatsApp "join" message.
// The trust's Certificate Builder template for this yojna if it has one, else the built-in design.
// (JSX inside: only import this from Next routes, not from plain-node tests.)
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { renderToBuffer } from "@react-pdf/renderer";
import { db, schema } from "@/db/index.js";
import { getTrustProfile } from "@/services/trust.js";
import { getActiveTemplate } from "@/services/certificateTemplates.js";
import { resolveCertificateImages } from "@/lib/certificateImages.js";
import { certificateCode } from "@/services/verify.js";
import CertificateServerSide from "@/components/pdfcom/Certificates/CertificateComServerSide";
import TemplateCertificatePdf from "@/components/pdfcom/Certificates/TemplateCertificatePdf";

/** m: member row from mobileApp.memberRow (program_id, program_name, program_hiname). */
export async function certificatePdf({ adminId, m, features, origin }) {
  const member = await db.query.members.findFirst({ where: eq(schema.members.id, m.id) });
  const program = { id: m.program_id, name: m.program_name, hiname: m.program_hiname };
  const trust = await getTrustProfile(adminId);
  const template = await getActiveTemplate(adminId, m.program_id).catch(() => null);
  if (template && (template.frameImg || template.elements?.length)) {
    const wantQr = features?.verifyQr !== false && template.elements?.some((e) => e.fieldKey === "verifyQr" && !e.hidden);
    const data = wantQr
      ? { ...member, verifyQr: await QRCode.toDataURL(`${origin}/verify/c/${encodeURIComponent(certificateCode(member.id))}`, { errorCorrectionLevel: "M", margin: 1, width: 300 }) }
      : member;
    const ready = await resolveCertificateImages(template, [data]);
    return renderToBuffer(
      <TemplateCertificatePdf template={ready.template} members={ready.members} program={program} trust={trust} title={`${member.displayName || ""} — सदस्यता प्रमाण पत्र`} />,
    );
  }
  return renderToBuffer(<CertificateServerSide data={member} selectedProgram={program} TrustData={trust} />);
}
