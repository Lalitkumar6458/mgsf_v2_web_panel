"use client";
// Preview + download of the Closed Members list PDF (loaded only in the browser).
import { Drawer, Button, Space } from "antd";
import { PDFDownloadLink, PDFViewer } from "@react-pdf/renderer";
import { FiDownload } from "react-icons/fi";
import ClosedMembersReportPDF from "@/components/pdfcom/ClosedMembersReportPDF";

export default function ClosedMembersPdfDrawer({ open, onClose, fileName, ...pdfProps }) {
  const doc = <ClosedMembersReportPDF {...pdfProps} />;
  return (
    <Drawer
      title="Closed Members — PDF"
      open={open}
      onClose={onClose}
      width={Math.min(1150, typeof window !== "undefined" ? window.innerWidth - 20 : 1150)}
      destroyOnClose
      extra={
        <Space>
          <PDFDownloadLink document={doc} fileName={fileName}>
            {({ loading }) => (
              <Button type="primary" icon={<FiDownload />} loading={loading}>Download PDF</Button>
            )}
          </PDFDownloadLink>
          <Button onClick={onClose}>Close</Button>
        </Space>
      }
      styles={{ body: { padding: 0 } }}
    >
      {open && (
        <PDFViewer style={{ width: "100%", height: "calc(100vh - 70px)", border: "none" }}>
          {doc}
        </PDFViewer>
      )}
    </Drawer>
  );
}
