import { PDFViewer } from "@react-pdf/renderer";
import CertificateServerSide from "./CertificateComServerSide";
import TemplateCertificatePdf from "./TemplateCertificatePdf";

/** The member certificate: the trust's Certificate Builder design if it has one, else the built-in layout. */
export function CertificateDocument({ memberData, selectedProgram, TrustData, template }) {
  if (template && (template.frameImg || template.elements?.length)) {
    return (
      <TemplateCertificatePdf template={template} members={[memberData]} program={selectedProgram} trust={TrustData}
        title={`${memberData?.displayName || ""} — सदस्यता प्रमाण पत्र`} />
    );
  }
  return <CertificateServerSide data={memberData} selectedProgram={selectedProgram} TrustData={TrustData} />;
}

const CertificateViewer = ({ memberData, selectedProgram, TrustData, template }) => (
  <PDFViewer style={{ width: "100%", height: "100vh", border: "none" }}>
    <CertificateDocument memberData={memberData} selectedProgram={selectedProgram} TrustData={TrustData} template={template} />
  </PDFViewer>
);

export default CertificateViewer;
