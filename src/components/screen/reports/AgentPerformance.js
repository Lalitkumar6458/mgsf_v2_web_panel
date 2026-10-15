"use client";
// Agent performance: who gets his members to pay on time, who collects most, who earns most commission.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { App, Button, DatePicker, Dropdown, Progress, Segmented, Table, Tag, Tooltip } from "antd";
import { FiDownload, FiFileText, FiRefreshCw, FiAward } from "react-icons/fi";
import { api } from "@/lib/client/api";
import { rs, rsPdf, downloadCsv, Tile } from "./shared";
import { useAmountsHidden } from "@/lib/client/privacy";

const { RangePicker } = DatePicker;
const MEDAL = ["🥇", "🥈", "🥉"];
const rateColor = (v) => (v >= 80 ? "#16a34a" : v >= 60 ? "#d97706" : "#dc2626");

export default function AgentPerformance({ program, onOpenAgentLate }) {
  useAmountsHidden(); // re-render on show / hide amounts
  const { message } = App.useApp();
  const trust = useSelector((s) => s.data.trustData);
  const [range, setRange] = useState(null);
  const [sortBy, setSortBy] = useState("score");
  const [data, setData] = useState({ agents: [], totals: {} });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!program?.id) return;
    setLoading(true);
    try {
      setData(await api.get(`/programs/${program.id}/reports/agents`, {
        from: range?.[0]?.format("YYYY-MM-DD"), to: range?.[1]?.format("YYYY-MM-DD"),
      }));
    } catch (e) { message.error(e.message); } finally { setLoading(false); }
  }, [program?.id, range, message]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const list = [...data.agents];
    const key = { score: "score", collected: "collected", commission: "commissionEarned", overdue: "overdueAmount", onTime: "onTimeRate" }[sortBy];
    if (sortBy !== "score") list.sort((a, b) => Number(b[key]) - Number(a[key]));
    return list;
  }, [data.agents, sortBy]);

  const active = data.agents.filter((a) => a.dues > 0 && a.agentId);
  const best = active[0];
  const topCollector = [...active].sort((a, b) => b.collected - a.collected)[0];
  const topCommission = [...active].sort((a, b) => b.commissionEarned - a.commissionEarned)[0];
  const worst = [...active].sort((a, b) => b.overdueAmount - a.overdueAmount)[0];
  const period = range ? `Closing ${range[0] ? range[0].format("DD-MM-YY") : "…"} → ${range[1] ? range[1].format("DD-MM-YY") : "…"}` : "Sab closings";

  const csvRows = () => rows.map((a) => [a.rank ?? "", a.agentName, a.members, a.dues, a.onTime, a.late, a.overdue, a.notDue,
    a.onTimeRate, a.collectionRate, a.avgLateDays, a.billed, a.collected, a.overdueAmount, a.commissionEarned, a.commissionPaid, a.commissionPending, a.score]);
  const headers = ["Rank", "Agent", "Members", "Entries", "On time", "Late", "Overdue", "Not due", "On-time %", "Collection %", "Avg days late", "Billed", "Collected", "Overdue amount", "Commission earned", "Commission paid", "Commission pending", "Score"];

  const exportPdf = async () => {
    try {
      const { downloadReportPdf } = await import("@/components/pdfcom/ReportTablePDF");
      const t = data.totals || {};
      await downloadReportPdf({
        title: `एजेंट प्रदर्शन रिपोर्ट • ${program.hiname || program.name}`,
        subtitle: `${period} · Score = 60% समय पर भुगतान + 40% वसूली`,
        TrustData: trust,
        summary: [
          { label: "एजेंट", value: active.length }, { label: "कुल वसूली", value: rsPdf(t.collected) },
          { label: "समय पर", value: t.onTime || 0, color: "#0a7d0a" }, { label: "देरी से", value: t.late || 0, color: "#b35c00" },
          { label: "बकाया", value: rsPdf(t.overdueAmount), color: "#c62828" }, { label: "कमीशन", value: rsPdf(t.commissionEarned) },
        ],
        columns: [
          { title: "Rank", w: 4 }, { title: "एजेंट", w: 12 }, { title: "सदस्य", w: 5, align: "right" }, { title: "समय पर", w: 5, align: "right" },
          { title: "देरी", w: 5, align: "right" }, { title: "बकाया", w: 5, align: "right" }, { title: "समय पर %", w: 6, align: "right" },
          { title: "वसूली %", w: 6, align: "right" }, { title: "औसत देरी", w: 6, align: "right" }, { title: "वसूली", w: 8, align: "right" },
          { title: "बकाया राशि", w: 8, align: "right" }, { title: "कमीशन", w: 7, align: "right" }, { title: "Score", w: 5, align: "right" },
        ],
        rows: rows.map((a) => [a.rank ?? "-", a.agentName, a.members, a.onTime, a.late, a.overdue, `${a.onTimeRate}%`, `${a.collectionRate}%`, a.avgLateDays,
          rsPdf(a.collected), { text: rsPdf(a.overdueAmount), color: a.overdueAmount ? "#c62828" : undefined }, rsPdf(a.commissionEarned), { text: a.score, bold: true }]),
      }, `agent-performance-${program.name}.pdf`);
    } catch (e) { message.error(e.message || "PDF failed"); }
  };

  const columns = [
    {
      title: "#", dataIndex: "rank", width: 60,
      render: (v) => (v ? <span className="text-lg">{MEDAL[v - 1] || <span className="text-sm text-gray-500 font-semibold">{v}</span>}</span> : "—"),
    },
    {
      title: "Agent", dataIndex: "agentName",
      render: (v, a) => <div><div className="font-semibold text-gray-900">{v}</div><div className="text-xs text-gray-500">{a.members} members · {a.agentPhone || ""}</div></div>,
    },
    {
      title: "On time", dataIndex: "onTimeRate", width: 150,
      render: (v, a) => (
        <div>
          <Progress percent={v} size="small" strokeColor={rateColor(v)} format={(p) => `${p}%`} />
          <div className="text-[11px] text-gray-500">{a.onTime} time par · {a.late} late · {a.overdue} baki</div>
        </div>
      ),
    },
    { title: "Collection", dataIndex: "collectionRate", width: 130, responsive: ["md"], render: (v, a) => <div><Progress percent={v} size="small" strokeColor={rateColor(v)} /><div className="text-[11px] text-gray-500">{rs(a.collected)}</div></div> },
    { title: "Avg late", dataIndex: "avgLateDays", width: 90, align: "right", render: (v) => (v ? `${v} din` : "—") },
    {
      title: "Overdue", dataIndex: "overdueAmount", width: 120, align: "right",
      render: (v, a) => (v ? <button className="text-red-600 font-semibold hover:underline" onClick={() => onOpenAgentLate?.(a.agentId || "none")}>{rs(v)}</button> : <span className="text-gray-300">₹0</span>),
    },
    {
      title: "Commission", dataIndex: "commissionEarned", width: 130, align: "right", responsive: ["lg"],
      render: (v, a) => <div className="tabular-nums">{rs(v)}<div className="text-[11px] text-gray-500">paid {rs(a.commissionPaid)}</div></div>,
    },
    { title: "Score", dataIndex: "score", width: 80, align: "right", render: (v) => <Tag color={v >= 80 ? "green" : v >= 60 ? "gold" : "red"} className="!m-0 font-semibold">{v}</Tag> },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Tile tone="green" label="🏆 Best agent" value={best?.agentName || "—"} sub={best ? `Score ${best.score} · ${best.onTimeRate}% time par` : ""} />
        <Tile tone="indigo" label="Sabse zyada vasooli" value={topCollector ? rs(topCollector.collected) : "—"} sub={topCollector?.agentName} />
        <Tile tone="blue" label="Sabse zyada commission" value={topCommission ? rs(topCommission.commissionEarned) : "—"} sub={topCommission?.agentName} />
        <Tile tone="red" label="Sabse zyada baki" value={worst?.overdueAmount ? rs(worst.overdueAmount) : "—"} sub={worst?.overdueAmount ? worst.agentName : ""} />
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <RangePicker value={range} onChange={setRange} format="DD-MM-YYYY" allowEmpty={[true, true]} placeholder={["Closing from", "Closing to"]} />
        <Segmented value={sortBy} onChange={setSortBy} options={[
          { label: <span className="inline-flex items-center gap-1"><FiAward /> Rank</span>, value: "score" },
          { label: "On time %", value: "onTime" }, { label: "Collection", value: "collected" },
          { label: "Commission", value: "commission" }, { label: "Overdue", value: "overdue" },
        ]} />
        <div className="flex gap-2 ml-auto">
          <Tooltip title="Refresh"><Button icon={<FiRefreshCw />} onClick={load} loading={loading} /></Tooltip>
          <Dropdown menu={{ items: [
            { key: "pdf", icon: <FiFileText />, label: "PDF", onClick: exportPdf },
            { key: "csv", icon: <FiDownload />, label: "CSV / Excel", onClick: () => downloadCsv(`agent-performance-${program.name}`, headers, csvRows()) },
          ] }}>
            <Button type="primary" icon={<FiDownload />}>Download</Button>
          </Dropdown>
        </div>
      </div>
      <div className="text-xs text-gray-500">Score = 60% time par bhare (jinki aakhri tarikh nikal chuki) + 40% vasooli. Overdue raashi par click karke us agent ki baki list dekhein.</div>
      <Table rowKey={(a) => a.agentId || "none"} size="middle" loading={loading} columns={columns} dataSource={rows} pagination={false} scroll={{ x: 860 }} />
    </div>
  );
}
