"use client";
// One member's complete closing-payment history: every closing, due date, when paid, how late, receipts.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { App, Button, Dropdown, Empty, Select, Spin, Table, Tag, Tooltip } from "antd";
import { FiDownload, FiFileText } from "react-icons/fi";
import { api } from "@/lib/client/api";
import { KIND, rs, rsPdf, d, downloadCsv, Tile } from "./shared";
import { useAmountsHidden } from "@/lib/client/privacy";

export default function MemberHistory({ program, memberId, onMemberChange }) {
  useAmountsHidden(); // re-render on show / hide amounts
  const { message } = App.useApp();
  const trust = useSelector((s) => s.data.trustData);
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef();

  const search = (q) => {
    clearTimeout(timer.current);
    if (!q || q.length < 2 || !program?.id) return;
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.get(`/programs/${program.id}/members`, { q, pageSize: 20 });
        setOptions(r.members.map((m) => ({ value: m.id, label: `${m.displayName} · ${m.registrationNumber || "—"}${m.village ? ` · ${m.village}` : ""}` })));
      } catch { /* ignore */ } finally { setSearching(false); }
    }, 300);
  };

  const load = useCallback(async () => {
    if (!memberId) { setData(null); return; }
    setLoading(true);
    try { setData(await api.get(`/members/${memberId}/payment-history`)); } catch (e) { message.error(e.message); } finally { setLoading(false); }
  }, [memberId, message]);
  useEffect(() => { load(); }, [load]);

  const m = data?.member;
  const s = data?.summary || {};

  const exportPdf = async () => {
    try {
      const { downloadReportPdf } = await import("@/components/pdfcom/ReportTablePDF");
      await downloadReportPdf({
        title: `सदस्य भुगतान इतिहास • ${m.displayName} (${m.registrationNumber || "-"})`,
        subtitle: `पिता/पति: ${m.fatherName || "-"} · गाँव: ${m.village || "-"} · मोबाइल: ${m.phone || "-"} · एजेंट: ${m.agentName || "Admin"} · जुड़ने की तिथि: ${d(m.dateJoin)} · किस्त: ${rsPdf(m.payAmount)} · ${m.programName}`,
        TrustData: trust,
        summary: [
          { label: "कुल क्लोजिंग", value: s.total }, { label: "समय पर", value: s.onTime, color: KIND.on_time.hex },
          { label: "देरी से", value: s.late, color: KIND.late.hex }, { label: "बकाया (समय निकल गया)", value: s.overdue, color: KIND.overdue.hex },
          { label: "भरा", value: rsPdf(s.paid) }, { label: "बाकी राशि", value: rsPdf(s.pendingAmount), color: KIND.overdue.hex },
          { label: "औसत देरी (दिन)", value: s.avgLateDays }, { label: "समय पर %", value: `${s.onTimeRate}%` },
        ],
        columns: [
          { title: "#", w: 3 }, { title: "क्लोजिंग सदस्य", w: 14 }, { title: "रजि.", w: 7 }, { title: "क्लोजिंग तिथि", w: 7 }, { title: "ग्रुप", w: 6 },
          { title: "राशि", w: 6, align: "right" }, { title: "भरा", w: 6, align: "right" }, { title: "अंतिम तिथि", w: 7 }, { title: "भुगतान तिथि", w: 7 },
          { title: "स्थिति", w: 8 }, { title: "देरी", w: 5, align: "right" }, { title: "रसीद / ट्रांजेक्शन", w: 14 },
        ],
        rows: data.rows.map((r, i) => [i + 1, r.closingName, r.closingRegNo, d(r.closingDate), r.closingGroup, rsPdf(r.amount), rsPdf(r.paidAmount), d(r.dueDate), d(r.paidDate),
          { text: KIND[r.kind]?.label, color: KIND[r.kind]?.hex }, { text: r.daysLate || "", bold: r.daysLate > 0 },
          (r.payments || []).map((p) => `${p.no} (${d(p.date)})`).join(", ")]),
      }, `payment-history-${m.registrationNumber || m.id}.pdf`, );
    } catch (e) { message.error(e.message || "PDF failed"); }
  };

  const exportCsv = () => downloadCsv(`payment-history-${m.registrationNumber || m.id}`,
    ["Closing member", "Closing reg", "Closing date", "Group", "Amount", "Paid", "Due date", "Paid date", "Status", "Days late", "Transactions"],
    data.rows.map((r) => [r.closingName, r.closingRegNo, d(r.closingDate), r.closingGroup, r.amount, r.paidAmount, d(r.dueDate), d(r.paidDate), KIND[r.kind]?.label, r.daysLate,
      (r.payments || []).map((p) => `${p.no} ${d(p.date)} ₹${p.amount} ${p.method}`).join(" | ")]));

  const columns = [
    { title: "Closing", dataIndex: "closingName", width: 240, render: (v, r) => <div><div className="font-medium">{v}</div><div className="text-xs text-gray-500">{r.closingRegNo} · {d(r.closingDate)}{r.closingGroup ? ` · ${r.closingGroup}` : ""}</div></div> },
    { title: "Amount", dataIndex: "amount", align: "right", width: 100, render: (v, r) => <div className="tabular-nums">{rs(v)}{r.paidAmount && r.paidAmount < v ? <div className="text-[11px] text-gray-500">paid {rs(r.paidAmount)}</div> : null}</div> },
    { title: "Due date", dataIndex: "dueDate", width: 105, render: d },
    { title: "Paid on", dataIndex: "paidDate", width: 105, render: d },
    { title: "Status", dataIndex: "kind", width: 125, render: (v) => <Tag color={KIND[v]?.color} className="!m-0">{KIND[v]?.label}</Tag> },
    { title: "Days late", dataIndex: "daysLate", width: 90, align: "right", render: (v, r) => (v ? <b className={r.kind === "overdue" ? "text-red-600" : "text-amber-600"}>{v}</b> : <span className="text-gray-300">0</span>) },
    {
      title: "Payments", dataIndex: "payments", responsive: ["lg"],
      render: (v) => (v || []).map((p) => <div key={p.no} className="text-xs text-gray-600 whitespace-nowrap">{p.no} · {d(p.date)} · {rs(p.amount)} · {p.method}</div>),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Select showSearch filterOption={false} onSearch={search} value={memberId || undefined} onChange={onMemberChange} style={{ minWidth: 320 }}
          placeholder="Member ka naam / reg no / phone likhein" notFoundContent={searching ? <Spin size="small" /> : null}
          options={memberId && m && !options.find((o) => o.value === memberId) ? [{ value: memberId, label: `${m.displayName} · ${m.registrationNumber || ""}` }, ...options] : options} />
        {m && (
          <Dropdown menu={{ items: [{ key: "pdf", icon: <FiFileText />, label: "PDF", onClick: exportPdf }, { key: "csv", icon: <FiDownload />, label: "CSV / Excel", onClick: exportCsv }] }}>
            <Button type="primary" icon={<FiDownload />} className="ml-auto">Download</Button>
          </Dropdown>
        )}
      </div>

      {!memberId ? (
        <Empty description="Member chunein — uski har closing ka payment, aakhri tarikh, kab bhara aur kitne din late, sab dikhega" />
      ) : loading || !m ? <div className="py-16 text-center"><Spin /></div> : (
        <>
          <div className="rounded-xl border border-gray-200 p-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="text-lg font-semibold text-gray-900 w-full">{m.displayName} <span className="text-gray-400 text-sm">{m.registrationNumber}</span></div>
            <span>Pita/Pati: <b>{m.fatherName || "—"}</b></span><span>Gaon: <b>{m.village || "—"}</b></span><span>Phone: <b>{m.phone || "—"}</b></span>
            <span>Agent: <b>{m.agentName || "Admin"}</b></span><span>Joined: <b>{d(m.dateJoin)}</b></span><span>Kist: <b>{rs(m.payAmount)}</b></span>
            {m.closingDate && <span>Closed: <b>{d(m.closingDate)}</b></span>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Tile label="Closings" value={s.total} />
            <Tile tone="green" label="Time par" value={s.onTime} sub={`${s.onTimeRate}%`} />
            <Tile tone="orange" label="Late bhara" value={s.late} sub={`avg ${s.avgLateDays} din`} />
            <Tile tone="red" label="Baki (overdue)" value={s.overdue} sub={s.maxDays ? `max ${s.maxDays} din` : ""} />
            <Tile tone="blue" label="Abhi time hai" value={s.notDue} />
            <Tile tone="indigo" label="Bhara" value={rs(s.paid)} />
            <Tile tone="red" label="Baki raashi" value={rs(s.pendingAmount)} />
          </div>
          <Table rowKey="id" size="middle" columns={columns} dataSource={data.rows} scroll={{ x: 1000 }} pagination={{ pageSize: 50, hideOnSinglePage: true }} />
        </>
      )}
    </div>
  );
}
