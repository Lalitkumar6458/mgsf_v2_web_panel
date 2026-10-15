import { PDFViewer } from "@react-pdf/renderer";
import MemberListPdfCom from "../MemberPdfCom";


const MemberListPdf = ({members,
            agentInfo,programInfo,programList,dateRange = null,
  searchText = '',TrustData}) => {

  return (
    <PDFViewer style={{ width: '100%', height: '100vh', border: 'none' }}>
   <MemberListPdfCom members={members} agentInfo={agentInfo} programInfo={programInfo} programList={programList} dateRange={dateRange} searchText={searchText} TrustData={TrustData} />
    </PDFViewer>
  );
};

export default MemberListPdf;