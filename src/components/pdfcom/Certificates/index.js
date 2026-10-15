import { PDFViewer } from "@react-pdf/renderer";
import Certificate from "./CertificateCom";
import { useSelector } from "react-redux";
import CertificateServerSide from "./CertificateComServerSide";


const CertificateViewer = ({memberData,selectedProgram,TrustData}) => {

  return (
    <PDFViewer style={{ width: '100%', height: '100vh', border: 'none' }}>
      <CertificateServerSide data={memberData} selectedProgram={selectedProgram} TrustData={TrustData} />
      {/* <Certificate data={memberData} selectedProgram={selectedProgram} TrustData={TrustData} /> */}
    </PDFViewer>
  );
};

export default CertificateViewer;