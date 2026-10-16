"use client";
// Late / overdue payments of one yojna: who paid late, by how many days, which closing; who has not paid yet.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { App, Button, DatePicker, Dropdown, Input, InputNumber, Segmented, Select, Table, Tag, Tooltip } from "antd";
import { FiDownload, FiFileText, FiRefreshCw, FiSearch, FiMessageCircle } from "react-icons/fi";
import { waUrl, reminderText, useTrustUpi } from "@/lib/client/whatsapp";
import { useFeature } from "@/lib/AuthProvider";
import { api } from "@/lib/client/api";
import { KIND, rs, rsPdf, d, downloadCsv, Tile, PDF_ROW_LIMIT } from "./shared";
import { useAmountsHidden } from "@/lib/client/privacy";

const { RangePicker } = DatePicker;

export default function LatePayments({ program, onOpenMember, initialAgentId }) {
  useAmountsHidden(); // re-render on show / hide amounts
  const { message } = App.useApp();
  const agents = useSelector((s) => s.data.agentsList) || [];
  const groups = useSelector((s) => s.data.closingGroupList) || [];
  const trust = useSelector((s) => s.data.trustData);
  const [kind, setKind] = useState(initialAgentId ? "overdue" : "problem");
  const [agentId, setAgentId] = useState(initialAgentId || undefined);
  const [groupId, setGroupId] = useState();
  const [range, setRange] = useState(null);
  const [minDays, setMinDays] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("days");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState({ rows: [], total: 0, summary: {} });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const upiId = useTrustUpi();
  const waOn = useFeature()("whatsapp");

  const filters = useMemo(() => ({
    kind, agentId, closingGroupId: groupId, minDays: minDays || undefined, q: q.trim() || undefined, sort,
    from: range?.[0]?.format("YYYY-MM-DD"), to: range?.[1]?.format("YYYY-MM-DD"),
  }), [kind, agentId, groupId, minDays, q, sort, range]);

  const load = useCallback(async () => {
    if (!program?.id) return;
    setLoading(true);
    try { setData(await api.get(`/programs/${program.id}/reports/late`, { ...filters, page, pageSize })); }
    catch (e) { message.error(e.message); } finally { setLoading(false); }
  }, [program?.id, filters, page, pageSize, message]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [filters]);

  const s = data.summary || {};
  const agentName = agentId === "none" ? "Admin (no agent)" : agents.find((a) => a.id === agentId)?.displayName;
  const filterText = [
    kind === "problem" ? "Late + Baki" : KIND[kind]?.label || "Sab",
    agentName && `Agent: ${agentName}`,
    groupId && `Group: ${groups.find((g) => g.id === groupId)?.name || ""}`,
    range && `Closing: ${range[0] ? range[0].format("DD-MM-YY") : "…"} → ${range[1] ? range[1].format("DD-MM-YY") : "…"}`,
    minDays && `${minDays}+ din`,
  ].filter(Boolean).join(" · ");

  const fetchAll = async () => {
    const r = await api.get(`/programs/${program.id}/reports/late`, { ...filters, all: 1 });
    if (r.rows.length >= 100000) message.warning("Sirf pehli 1,00,000 entries — filter lagakar chhota karein");
    return r.rows;
  };

  const exportCsv = async () => {
    setBusy(true);
    try {
      const rows = await fetchAll();
      downloadCsv(`late-payments-${program.name}`, ["Member", "Reg no", "Phone", "Village", "Agent", "Closing member", "Closing reg", "Closing date", "Group", "Amount", "Paid", "Due date", "Paid date", "Status", "Days late"],
        rows.map((r) => [r.payerName, r.payerRegNo, r.payerPhone, r.payerVillage, r.agentName || "Admin", r.closingName, r.closingRegNo, d(r.closingDate), r.closingGroup, r.amount, r.paidAmount, d(r.dueDate), d(r.paidDate), KIND[r.kind]?.label, r.daysLate]));
    } catch (e) { message.error(e.message); } finally { setBusy(false); }
  };

  const exportPdf = async () => {
    setBusy(true);
    const hide = message.loading("PDF ban raha hai… badi list mein thoda samay lagta hai", 0);
    try {
      // only what fits in the PDF is fetched (top rows in the chosen order)
      const r = await api.get(`/programs/${program.id}/reports/late`, { ...filters, limit: PDF_ROW_LIMIT });
      const rows = r.rows;
      const cut = r.total > rows.length;
      const { downloadReportPdf } = await import("@/components/pdfcom/ReportTablePDF");
      await downloadReportPdf({
        title: `भुगतान देरी रिपोर्ट • ${program.hiname || program.name}`,
        subtitle: `${filterText} · भुगतान अवधि: क्लोजिंग से ${program.dueDays ?? 45} दिन`,
        TrustData: trust,
        summary: [
          { label: "कुल", value: s.total || 0 }, { label: "समय पर", value: s.onTime || 0, color: KIND.on_time.hex },
          { label: "देरी से भरा", value: s.late || 0, color: KIND.late.hex }, { label: "बकाया (समय निकल गया)", value: s.overdue || 0, color: KIND.overdue.hex },
          { label: "बकाया राशि", value: rsPdf(s.overdueAmount), color: KIND.overdue.hex }, { label: "औसत देरी (दिन)", value: s.avgLateDays || 0 },
        ],
        columns: [
          { title: "#", w: 3 }, { title: "सदस्य", w: 14 }, { title: "रजि.", w: 7 }, { title: "एजेंट", w: 9 }, { title: "क्लोजिंग सदस्य", w: 13 },
          { title: "क्लोजिंग तिथि", w: 7 }, { title: "राशि", w: 6, align: "right" }, { title: "अंतिम तिथि", w: 7 }, { title: "भुगतान तिथि", w: 7 },
          { title: "स्थिति", w: 8 }, { title: "देरी (दिन)", w: 6, align: "right" },
        ],
        rows: rows.map((r, i) => [i + 1, r.payerName, r.payerRegNo, r.agentName || "Admin", r.closingName, d(r.closingDate), rsPdf(r.amount), d(r.dueDate), d(r.paidDate),
          { text: KIND[r.kind]?.label, color: KIND[r.kind]?.hex }, { text: r.daysLate || "", bold: r.daysLate > 0, color: r.daysLate ? KIND[r.kind]?.hex : undefined }]),
        note: cut ? `PDF mein ${r.total} mein se pehli ${rows.length} entries. Poori list CSV mein lein.` : undefined,
      }, `late-payments-${program.name}.pdf`);
    } catch (e) { message.error(e.message || "PDF failed"); } finally { hide(); setBusy(false); }
  };

  const columns = [
    {
      title: "Member", dataIndex: "payerName",
      render: (v, r) => (
        <button className="text-left" onClick={() => onOpenMember?.(r.payerId)}>
          <div className="font-medium text-indigo-700 hover:underline">{v}</div>
          <div className="text-xs text-gray-500">{r.payerRegNo}{r.payerPhone ? ` · ${r.payerPhone}` : ""}</div>
        </button>
      ),
    },
    { title: "Agent", dataIndex: "agentName", responsive: ["md"], render: (v) => v || <span className="text-gray-400">Admin</span> },
    {
      title: "Closing", dataIndex: "closingName",
      render: (v, r) => <div><div>{v}</div><div className="text-xs text-gray-500">{d(r.closingDate)}{r.closingGroup ? ` · ${r.closingGroup}` : ""}</div></div>,
    },
    { title: "Amount", dataIndex: "amount", align: "right", width: 90, render: (v, r) => <div className="tabular-nums">{rs(v)}{r.paidAmount && r.paidAmount < v ? <div className="text-[11px] text-gray-500">paid {rs(r.paidAmount)}</div> : null}</div> },
    { title: "Due date", dataIndex: "dueDate", width: 105, render: d },
    { title: "Paid on", dataIndex: "paidDate", width: 105, render: d },
    { title: "Status", dataIndex: "kind", width: 125, render: (v) => <Tag color={KIND[v]?.color} className="!m-0">{KIND[v]?.label}</Tag> },
    {
      title: "Days late", dataIndex: "daysLate", align: "right", width: 95,
      render: (v, r) => (v ? <b className={r.kind === "overdue" ? "text-red-600" : "text-amber-600"}>{v}</b> : <span className="text-gray-300">0</span>),
    },
    {
      title: "", key: "wa", width: 52, align: "center",
      render: (_, r) => {
        if (!waOn || (r.kind !== "overdue" && r.kind !== "not_due")) return null;
        const url = waUrl(r.payerPhone, reminderText({
          name: r.payerName, trustName: trust?.name, programName: program?.hiname || program?.name, count: 1,
          amount: (r.amount || 0) - (r.paidAmount || 0), lastDate: r.dueDate ? d(r.dueDate) : "", upiId,
          closings: [`${r.closingName}${r.closingDate ? ` (${d(r.closingDate)})` : ""}`],
        }));
        return url ? <Tooltip title="WhatsApp pe yaad dilayein"><Button size="small" type="text" icon={<FiMessageCircle className="text-green-600" />} href={url} target="_blank" /></Tooltip> : null;
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile label="Problem (late + baki)" value={(s.late || 0) + (s.overdue || 0)} tone="indigo" active={kind === "problem"} onClick={() => setKind("problem")} />
        <Tile label="Time par" value={s.onTime || 0} tone="green" active={kind === "on_time"} onClick={() => setKind("on_time")} />
        <Tile label="Late bhara" value={s.late || 0} sub={`avg ${s.avgLateDays || 0} din late`} tone="orange" active={kind === "late"} onClick={() => setKind("late")} />
        <Tile label="Baki (overdue)" value={s.overdue || 0} sub={rs(s.overdueAmount)} tone="red" active={kind === "overdue"} onClick={() => setKind("overdue")} />
        <Tile label="Abhi time hai" value={s.notDue || 0} tone="blue" active={kind === "not_due"} onClick={() => setKind("not_due")} />
        <Tile label="Sab entries" value={s.total || 0} sub={`max ${s.maxDays || 0} din`} active={kind === "all"} onClick={() => setKind("all")} />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input allowClear prefix={<FiSearch className="text-gray-400" />} placeholder="Member / closing / reg / phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 230 }} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="All agents" value={agentId} onChange={setAgentId} style={{ width: 180 }}
          options={[{ value: "none", label: "Admin (no agent)" }, ...agents.map((a) => ({ value: a.id, label: a.displayName }))]} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="All closing groups" value={groupId} onChange={setGroupId} style={{ width: 170 }}
          options={groups.map((g) => ({ value: g.id, label: g.name }))} />
        <RangePicker value={range} onChange={setRange} format="DD-MM-YYYY" allowEmpty={[true, true]} placeholder={["Closing from", "Closing to"]} />
        <InputNumber min={1} placeholder="Min days late" value={minDays} onChange={setMinDays} style={{ width: 140 }} />
        <Segmented value={sort} onChange={setSort} options={[{ label: "Most late", value: "days" }, { label: "Amount", value: "amount" }, { label: "Due date", value: "due" }]} />
        <div className="flex gap-2 ml-auto">
          <Tooltip title="Refresh"><Button icon={<FiRefreshCw />} onClick={load} loading={loading} /></Tooltip>
          <Dropdown menu={{ items: [{ key: "pdf", icon: <FiFileText />, label: "PDF", onClick: exportPdf }, { key: "csv", icon: <FiDownload />, label: "CSV / Excel", onClick: exportCsv }] }}>
            <Button type="primary" icon={<FiDownload />} loading={busy}>Download</Button>
          </Dropdown>
        </div>
      </div>
      <div className="text-xs text-gray-500">
        Payment ki aakhri tarikh = closing date (ya jis din closing record hui) + {program?.dueDays ?? 45} din. Late = aakhri tarikh ke baad poora bhara.
      </div>

      <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={data.rows} scroll={{ x: 900 }}
        pagination={{ current: page, pageSize, total: data.total, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); }, showTotal: (t) => `${t.toLocaleString("en-IN")} entries` }} />
    </div>
  );
}
