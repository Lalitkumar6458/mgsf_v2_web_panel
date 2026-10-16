
import MemberRegFormPdf from '@/components/pdfcom/MemberRegFormPdf';
import RegFromPdf, { BLANK_MEMBER } from '@/components/pdfcom/MemberRegFormPdf/RegFromPdf';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { Button, Drawer, Space, Typography } from 'antd'
import React from 'react'
import { useSelector } from 'react-redux';

const MemberRegForm = ({
    open,
    onClose,
    memberData: givenData,
    blank = false,        // khaali form — print karke haath se bharne ke liye
}) => {
    const memberData = blank ? BLANK_MEMBER : givenData;
    const { Title } = Typography;
    const [isLoading, setIsLoading] = React.useState(false);
  const selectedProgram = useSelector((state) => state.data.selectedProgram);
  const agentList=useSelector((state)=>state.data.agentsList)
  const TrustData = useSelector((state) => state.data.trustData);
    const fileName = blank ? 'Khaali_Registration_Form.pdf'
      : memberData ? `${String(memberData.displayName || 'Member').replaceAll(" ","_")}_${memberData?.registrationNumber || ''}_RegForm.pdf` : 'RegForm.pdf';


    const memberAgent=agentList.find((x)=>x.id===memberData?.agentId)
  return (
    <div>
        <Drawer
        title={<Title level={4} style={{ margin: 0 }}>{fileName}</Title>}
        width={800}
        placement="right"
        onClose={onClose}
        open={open}
        maskClosable={false}
        destroyOnHidden
        keyboard={false}
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={onClose} size="large" >
              रद्द करें
            </Button>
            <PDFDownloadLink style={{
                background:"#1890ff",
                color:"#fff",
                border:"none",
                padding:"6px 15px",
                borderRadius:"4px",
                fontSize:"16px",
                cursor:"pointer",
            }} fileName={fileName} document={<RegFromPdf data={{...memberData,agentPhone:memberAgent?.phone}} selectedProgram={selectedProgram} TrustData={TrustData} />} >
                Download Pdf
            </PDFDownloadLink>
         
          </Space>
        }
      > 
      <MemberRegFormPdf memberData={{...memberData,agentPhone:memberAgent?.phone}} selectedProgram={selectedProgram}/>
      {/* <CertificateViewer memberData={{...memberData,agentPhone:memberAgent?.phone}} selectedProgram={selectedProgram}/> */}
      </Drawer>
    </div>
  )
}

export default MemberRegForm