"use client";
// Export the current (filtered / selected) member list as a real PDF file.
// Options: columns, page orientation, group by agent, title. Live preview + download.
import { useMemo, useState, useEffect } from "react";
import { Drawer, Button, Checkbox, Segmented, Switch, Input, Space, Tag } from "antd";
import { PDFDownloadLink, PDFViewer } from "@react-pdf/renderer";
import { FiDownload, FiEye } from "react-icons/fi";
import MemberListReportPDF, { MEMBER_PDF_COLUMNS } from "@/components/pdfcom/MemberListReportPDF";

const DEFAULT_COLS = ["reg", "name", "father", "phone", "village", "agent", "join", "fees", "dues"];
const STORE = "mgsf.memberPdf.v1";

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; }
};

export default function MemberPdfExportDrawer({ open, onClose, members, filtersText, programName, TrustData, defaultTitle }) {
  const saved = typeof window !== "undefined" ? load() : null;
  const [columns, setColumns] = useState(saved?.columns || DEFAULT_COLS);
  const [orientation, setOrientation] = useState(saved?.orientation || "landscape");
  const [groupByAgent, setGroupByAgent] = useState(!!saved?.groupByAgent);
  const [title, setTitle] = useState(defaultTitle || "सदस्य सूची");
  const [preview, setPreview] = useState(false);

  useEffect(() => { setTitle(defaultTitle || "सदस्य सूची"); }, [defaultTitle]);
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ columns, orientation, groupByAgent })); } catch { /* private mode */ }
  }, [columns, orientation, groupByAgent]);
  useEffect(() => { if (!open) setPreview(false); }, [open]);

  // portrait has room for fewer columns
  const tooMany = orientation === "portrait" && columns.length > 9;

  const doc = useMemo(() => (
    <MemberListReportPDF
      members={members} columns={columns} orientation={orientation} groupByAgent={groupByAgent}
      title={title} filtersText={filtersText} programName={programName} TrustData={TrustData}
    />
  ), [members, columns, orientation, groupByAgent, title, filtersText, programName, TrustData]);

  const fileName = `members-${(programName || "list").replace(/\s+/g, "_")}-${new Date().toISOString().slice(0, 10)}.pdf`;

  return (
    <Drawer
      title={<span>Download member list PDF <Tag className="ml-2" color="blue">{members.length} members</Tag></span>}
      open={open} onClose={onClose} destroyOnClose
      width={typeof window !== "undefined" ? Math.min(preview ? 1150 : 560, window.innerWidth) : 560}
      extra={
        <Space wrap>
          <Button icon={<FiEye />} onClick={() => setPreview((p) => !p)}>{preview ? "Hide preview" : "Preview"}</Button>
          <PDFDownloadLink document={doc} fileName={fileName}>
            {({ loading }) => <Button type="primary" icon={<FiDownload />} loading={loading} disabled={!columns.length}>Download PDF</Button>}
          </PDFDownloadLink>
        </Space>
      }
      styles={{ body: { padding: 0, display: "flex", flexDirection: "column" } }}
    >
      <div className="p-5 space-y-5 border-b border-gray-100">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Report title</div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          {filtersText ? <div className="text-xs text-gray-500 mt-1.5">Filters printed on the report: {filtersText}</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Page</div>
            <Segmented value={orientation} onChange={setOrientation}
              options={[{ label: "Landscape (wide)", value: "landscape" }, { label: "Portrait", value: "portrait" }]} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <Switch checked={groupByAgent} onChange={setGroupByAgent} />
            <span className="text-sm">Group by agent (with sub-totals)</span>
          </label>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Columns ({columns.length})</span>
            <span className="space-x-3 text-xs">
              <button className="text-blue-600" onClick={() => setColumns(MEMBER_PDF_COLUMNS.map((c) => c.key))}>All</button>
              <button className="text-blue-600" onClick={() => setColumns(DEFAULT_COLS)}>Default</button>
              <button className="text-blue-600" onClick={() => setColumns(["reg", "name"])}>Clear</button>
            </span>
          </div>
          <Checkbox.Group value={columns} onChange={setColumns} className="w-full">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-1.5 gap-x-3 w-full">
              {MEMBER_PDF_COLUMNS.map((c) => <Checkbox key={c.key} value={c.key}>{c.title}</Checkbox>)}
            </div>
          </Checkbox.Group>
          {tooMany && <div className="text-xs text-amber-600 mt-2">Portrait page is narrow — use Landscape for more than 9 columns.</div>}
        </div>
      </div>
      {preview && open && (
        <PDFViewer style={{ width: "100%", flex: 1, minHeight: 600, border: "none" }}>{doc}</PDFViewer>
      )}
    </Drawer>
  );
}
