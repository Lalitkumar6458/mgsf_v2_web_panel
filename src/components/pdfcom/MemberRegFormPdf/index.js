import { PDFViewer } from "@react-pdf/renderer";
import { useSelector } from "react-redux";
import RegFromPdf from "./RegFromPdf";
import ClosingFormPdf from "../ClosingForm/ClosingFormPdf";


const MemberRegFormPdf = ({memberData,selectedProgram}) => {
  const TrustData = useSelector((state) => state.data.trustData);
  console.log(selectedProgram,"data selectedProgram",memberData)
  return (
    <PDFViewer style={{ width: '100%', height: '100vh', border: 'none' }}>
      <RegFromPdf data={memberData} selectedProgram={selectedProgram} TrustData={TrustData}/>
      {/* <ClosingFormPdf data={memberData} selectedProgram={selectedProgram}/> */}
    </PDFViewer>
  );
};

export default MemberRegFormPdf;