import CertificateViewer, { CertificateDocument } from '@/components/pdfcom/Certificates';
import { useCertificateTemplate } from '@/lib/client/useCertificateTemplate';
import { attachVerifyQr, usesVerifyQr } from '@/lib/client/verifyQr';
import { useFeature } from '@/lib/AuthProvider';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { Button, Drawer, Space, Spin, Typography } from 'antd'
import React from 'react'
import { useSelector } from 'react-redux';

const MemberCertificateCom = ({
    open,
    onClose,
    memberData,         
}) => {
    const { Title } = Typography;
    const [isLoading, setIsLoading] = React.useState(false);
  const selectedProgram = useSelector((state) => state.data.selectedProgram);
  const agentList=useSelector((state)=>state.data.agentsList)
    const fileName = memberData ? `${memberData.displayName.replaceAll(" ","_")+"_"+memberData?.registrationNumber || 'Member'}_Certificate.pdf` : 'Certificate.pdf';

 const TrustData = useSelector((state) => state.data.trustData);
    const memberAgent=agentList.find((x)=>x.id===memberData?.agentId)
    // the trust's Certificate Builder design for this yojna (null → built-in certificate)
    const { loading: tplLoading, template } = useCertificateTemplate(selectedProgram?.id, open);
    const baseData = { ...memberData, agentName: memberData?.agentName || memberAgent?.displayName, agentPhone: memberAgent?.phone };
    // design with a "Verify QR" element → fetch this member's signed verify link and draw the QR
    const [qrData, setQrData] = React.useState(null);
    const qrOn = useFeature()('verifyQr');
    React.useEffect(() => {
      setQrData(null);
      if (!open || !memberData?.id || !qrOn || !usesVerifyQr(template)) return;
      let alive = true;
      attachVerifyQr([{ id: memberData.id }], template).then(([m]) => { if (alive) setQrData(m?.verifyQr || null); }).catch(() => {});
      return () => { alive = false; };
    }, [open, memberData?.id, template, qrOn]);
    const certData = qrData ? { ...baseData, verifyQr: qrData } : baseData;
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
            }} fileName={fileName} document={<CertificateDocument memberData={certData} selectedProgram={selectedProgram} TrustData={TrustData} template={template} />} >
                Download Pdf
            </PDFDownloadLink>
         
          </Space>
        }
      > 
      {tplLoading ? <div style={{ padding: 64, textAlign: 'center' }}><Spin /></div> : (
        <CertificateViewer memberData={certData} selectedProgram={selectedProgram} TrustData={TrustData} template={template} />
      )}
      </Drawer>
    </div>
  )
}

export default MemberCertificateCom