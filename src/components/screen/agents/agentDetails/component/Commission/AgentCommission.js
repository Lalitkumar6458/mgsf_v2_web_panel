"use client";
// Agent → Commission tab: rates, totals, full history (join fees + closing payments), payouts.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  App, Button, DatePicker, Empty, Input, Modal, Popconfirm, Segmented, Select, Table, Tag, Tooltip, Checkbox,
} from "antd";
import { FiDownload, FiRefreshCw, FiPlusCircle, FiRotateCcw, FiSearch, FiCreditCard, FiList } from "react-icons/fi";
import dayjs from "dayjs";
import { api } from "@/lib/client/api";
import { commissionSummaryText, money as rawMoney, rateLabel, SOURCE_LABEL, normalizeCommission } from "@/lib/commission";
import { amountsHidden, useAmountsHidden, MASK } from "@/lib/client/privacy";

const money = (v) => (amountsHidden() ? MASK : rawMoney(v)); // hidden until the eye is clicked
import PayCommissionDrawer from "./PayCommissionDrawer";

const { RangePicker } = DatePicker;
const STATUS = { pending: { color: "orange", label: "Pending" }, paid: { color: "green", label: "Paid" }, cancelled: { color: "default", label: "Cancelled" } };

function Tile({ label, value, sub, tone = "gray" }) {
  const tones = {
    gray: "bg-white border-gray-200", indigo: "bg-indigo-50 border-indigo-100", green: "bg-emerald-50 border-emerald-100",
    amber: "bg-amber-50 border-amber-100",
  };
  return (
    <div className={`rounded-xl border p-3.5 ${tones[tone]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-gray-500 mt-0.5">{sub}</div> : null}
    </div>
  );
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function AgentCommission({ agentId, agentInfo }) {
  useAmountsHidden();
  const { message } = App.useApp();
  const programs = useSelector((s) => s.data.programList) || [];
  const [view, setView] = useState("history");
  const [programId, setProgramId] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [range, setRange] = useState(null);
  const [q, setQ] = useState("");
  const [payoutId, setPayoutId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState({ commissions: [], total: 0, totalAmount: 0, summary: null });
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [payOpen, setPayOpen] = useState(false);
  const [backfill, setBackfill] = useState(null);
  const [agent, setAgent] = useState(agentInfo);

  const filters = useMemo(() => ({
    programId: programId || undefined, source: source || undefined, status: status || undefined,
    from: range?.[0] ? range[0].format("YYYY-MM-DD") : undefined, to: range?.[1] ? range[1].format("YYYY-MM-DD") : undefined,
    q: q.trim() || undefined, payoutId: payoutId || undefined,
  }), [programId, source, status, range, q, payoutId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, p, a] = await Promise.all([
        api.get(`/agents/${agentId}/commissions`, { ...filters, page, pageSize }),
        api.get(`/agents/${agentId}/commission-payouts`),
        api.get(`/agents/${agentId}`).catch(() => null),
      ]);
      setData(h);
      setPayouts(p.payouts || []);
      if (a?.agent) setAgent((x) => ({ ...x, ...a.agent }));
    } catch (e) {
      message.error(e.message || "Could not load commission");
    } finally {
      setLoading(false);
    }
  }, [agentId, filters, page, pageSize, message]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); setSelectedKeys([]); setSelectedRows([]); }, [filters]);

  const s = data.summary || {};
  const cfg = normalizeCommission(agent?.commission);
  const programName = programs.find((p) => p.id === programId)?.name;

  const exportCsv = async () => {
    try {
      const all = await api.get(`/agents/${agentId}/commissions`, { ...filters, all: 1 });
      const head = ["Date", "Type", "Kind", "Member", "Reg no", "Closing member", "Program", "Payment", "Rate", "Commission", "Status", "Payout no", "Note"];
      const lines = all.commissions.map((r) => [
        r.paymentDate, SOURCE_LABEL[r.source], r.kind, r.memberName, r.memberRegNo, r.closingMemberName || "", r.programName,
        r.baseAmount, rateLabel(r.rateType, r.rateValue), r.amount, r.status, r.payoutNumber || "", r.note || "",
      ].map(csvCell).join(","));
      const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `commission-${(agent?.displayName || agentId).replace(/\s+/g, "_")}-${dayjs().format("YYYY-MM-DD")}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      message.error(e.message || "Export failed");
    }
  };

  const revert = async (p) => {
    try {
      await api.post(`/commission-payouts/${p.id}/revert`, { reason: "Reverted from admin panel" });
      message.success(`${p.payoutNumber} reverted — entries are pending again`);
      load();
    } catch (e) {
      message.error(e.message || "Revert failed");
    }
  };

  const runBackfill = async () => {
    try {
      const r = await api.post(`/agents/${agentId}/commissions/backfill`, {
        programId: programId || undefined,
        from: backfill.range?.[0]?.format("YYYY-MM-DD"), to: backfill.range?.[1]?.format("YYYY-MM-DD"),
        sources: backfill.sources,
      });
      message.success(r.added ? `${r.added} old payments added (join fees ${r.joinFees}, closing ${r.closing})` : "Nothing new — all payments already counted");
      setBackfill(null);
      load();
    } catch (e) {
      message.error(e.message || "Failed");
    }
  };

  const columns = [
    {
      title: "Date", dataIndex: "paymentDate", width: 100,
      render: (v) => <span className="whitespace-nowrap">{dayjs(v).format("DD-MM-YYYY")}</span>,
    },
    {
      title: "Type", dataIndex: "source", width: 140,
      render: (v, r) => (
        <div className="flex flex-col gap-0.5 items-start">
          <Tag color={v === "closing" ? "blue" : "purple"} className="!m-0">{SOURCE_LABEL[v]}</Tag>
          {r.kind === "reversal" && <Tag color="red" className="!m-0">Reversal</Tag>}
        </div>
      ),
    },
    {
      title: "Member", dataIndex: "memberName",
      render: (v, r) => (
        <div className="min-w-0">
          <div className="font-medium text-gray-900 truncate">{v || "—"}</div>
          <div className="text-xs text-gray-500">{r.memberRegNo}{r.memberVillage ? ` · ${r.memberVillage}` : ""}</div>
        </div>
      ),
    },
    {
      title: "Closing / Program", dataIndex: "closingMemberName", responsive: ["md"],
      render: (v, r) => (
        <div className="min-w-0 text-xs">
          {v ? <div className="text-gray-800">{v} <span className="text-gray-400">{r.closingRegNo}</span></div> : null}
          <div className="text-gray-500">{r.programName}</div>
        </div>
      ),
    },
    { title: "Payment", dataIndex: "baseAmount", align: "right", width: 95, render: (v) => <span className="tabular-nums">{money(v)}</span> },
    { title: "Rate", dataIndex: "rateValue", width: 75, responsive: ["sm"], render: (v, r) => rateLabel(r.rateType, v) },
    {
      title: "Commission", dataIndex: "amount", align: "right", width: 110,
      render: (v) => <b className={`tabular-nums ${v < 0 ? "text-red-600" : "text-gray-900"}`}>{money(v)}</b>,
    },
    {
      title: "Status", dataIndex: "status", width: 130,
      render: (v, r) => (
        <div className="flex flex-col items-start gap-0.5">
          <Tag color={STATUS[v]?.color} className="!m-0">{STATUS[v]?.label || v}</Tag>
          {r.payoutNumber && <span className="text-[11px] text-gray-500">{r.payoutNumber}</span>}
          {v === "cancelled" && r.note && <span className="text-[11px] text-gray-400">{r.note}</span>}
        </div>
      ),
    },
  ];

  const payoutColumns = [
    { title: "Payout no.", dataIndex: "payoutNumber", render: (v) => <b>{v}</b> },
    { title: "Date", dataIndex: "payoutDate", render: (v) => dayjs(v).format("DD-MM-YYYY") },
    { title: "Amount", dataIndex: "amount", align: "right", render: (v) => <b className="tabular-nums">{money(v)}</b> },
    { title: "Mode", dataIndex: "paymentMode", responsive: ["sm"], render: (v, r) => <span className="uppercase text-xs">{v}{r.reference ? ` · ${r.reference}` : ""}</span> },
    { title: "Entries", dataIndex: "commissionCount", align: "right", responsive: ["md"] },
    { title: "By", dataIndex: "createdByName", responsive: ["lg"] },
    {
      title: "Status", dataIndex: "status",
      render: (v, r) => v === "paid" ? <Tag color="green">Paid</Tag> : <Tooltip title={r.revertReason}><Tag>Reverted</Tag></Tooltip>,
    },
    {
      title: "", key: "act", width: 150,
      render: (_, r) => (
        <div className="flex gap-1 justify-end">
          <Tooltip title="See entries"><Button size="small" icon={<FiList />} onClick={() => { setPayoutId(r.id); setStatus(""); setView("history"); }} /></Tooltip>
          {r.status === "paid" && (
            <Popconfirm title="Revert this payout?" description="Its entries will become pending again." okText="Revert" okButtonProps={{ danger: true }} onConfirm={() => revert(r)}>
              <Button size="small" danger icon={<FiRotateCcw />}>Revert</Button>
            </Popconfirm>
          )}
        </div>
      ),
    },
  ];

  const selectedSum = selectedRows.reduce((a, r) => a + Number(r.amount || 0), 0);
  const activePayout = payouts.find((p) => p.id === payoutId);

  return (
    <div className="space-y-4">
      {/* rate + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tag color={cfg.enabled ? "purple" : "default"} className="!text-sm !py-0.5">Commission: {commissionSummaryText(cfg)}</Tag>
          {!cfg.enabled && <span className="text-xs text-gray-500">Agent edit karke commission on karein.</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={programId} onChange={setProgramId} style={{ minWidth: 170 }}
            options={[{ value: "", label: "All yojna" }, ...programs.map((p) => ({ value: p.id, label: p.name }))]} />
          <Tooltip title="Refresh"><Button icon={<FiRefreshCw />} onClick={load} loading={loading} /></Tooltip>
          <Button icon={<FiPlusCircle />} disabled={!cfg.enabled} onClick={() => setBackfill({ range: null, sources: ["join_fees", "closing"] })}>Old payments</Button>
          <Button icon={<FiDownload />} onClick={exportCsv}>CSV</Button>
          <Button type="primary" icon={<FiCreditCard />} disabled={!(Number(s.pending) > 0) && !selectedRows.length} onClick={() => setPayOpen(true)}>Pay agent</Button>
        </div>
      </div>

      {/* totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile tone="indigo" label="Total earned" value={money(s.earned)} sub={`Join fees ${money(s.joinFees)} · Closing ${money(s.closing)}`} />
        <Tile tone="green" label="Paid to agent" value={money(s.paid)} sub={`${s.payouts || 0} payouts${s.lastPayoutDate ? ` · last ${dayjs(s.lastPayoutDate).format("DD MMM")}` : ""}`} />
        <Tile tone="amber" label="Balance to pay" value={money(s.pending)} sub={`${s.pendingCount || 0} entries pending`} />
        <Tile label="Reversed / cancelled" value={money(Math.abs(s.reversed || 0))} sub={`${s.cancelledCount || 0} cancelled before payout`} />
      </div>

      <Segmented value={view} onChange={setView} options={[
        { label: `History (${data.total})`, value: "history" },
        { label: `Payouts (${payouts.length})`, value: "payouts" },
      ]} />

      {view === "history" ? (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <Input allowClear prefix={<FiSearch className="text-gray-400" />} placeholder="Member / reg no / closing" value={q}
              onChange={(e) => setQ(e.target.value)} style={{ width: 230 }} />
            <Select value={source} onChange={setSource} style={{ width: 160 }}
              options={[{ value: "", label: "All types" }, { value: "join_fees", label: "Join fees" }, { value: "closing", label: "Closing payment" }]} />
            <Select value={status} onChange={setStatus} style={{ width: 140 }}
              options={[{ value: "", label: "All status" }, { value: "pending", label: "Pending" }, { value: "paid", label: "Paid" }, { value: "cancelled", label: "Cancelled" }]} />
            <RangePicker value={range} onChange={setRange} format="DD-MM-YYYY" allowEmpty={[true, true]} />
            {activePayout && (
              <Tag closable color="green" onClose={() => setPayoutId(null)} className="!py-1">Payout {activePayout.payoutNumber}</Tag>
            )}
          </div>

          {selectedRows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-sm">
              <span><b>{selectedRows.length}</b> selected · <b>{money(selectedSum)}</b></span>
              <span className="flex gap-2">
                <Button size="small" onClick={() => { setSelectedKeys([]); setSelectedRows([]); }}>Clear</Button>
                <Button size="small" type="primary" onClick={() => setPayOpen(true)}>Pay selected</Button>
              </span>
            </div>
          )}

          <Table
            rowKey="id" size="middle" loading={loading} columns={columns} dataSource={data.commissions}
            scroll={{ x: 820 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={cfg.enabled ? "No commission yet for these filters" : "Commission is off for this agent"} /> }}
            rowSelection={{
              selectedRowKeys: selectedKeys,
              preserveSelectedRowKeys: true,
              getCheckboxProps: (r) => ({ disabled: r.status !== "pending" }),
              onChange: (keys, rows) => { setSelectedKeys(keys); setSelectedRows((prev) => {
                const map = new Map(prev.map((r) => [r.id, r]));
                rows.forEach((r) => r && map.set(r.id, r));
                return keys.map((k) => map.get(k)).filter(Boolean);
              }); },
            }}
            pagination={{
              current: page, pageSize, total: data.total, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200],
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
              showTotal: (t) => `${t} entries · ${money(data.totalAmount)}`,
            }}
          />
        </>
      ) : (
        <Table rowKey="id" size="middle" loading={loading} columns={payoutColumns} dataSource={payouts} scroll={{ x: 640 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No payouts yet" /> }} pagination={{ pageSize: 20 }} />
      )}

      <PayCommissionDrawer
        open={payOpen} onClose={() => setPayOpen(false)} agent={agent || { id: agentId }} summary={s}
        selected={selectedRows} filters={{ programId: programId || undefined }} programName={programName}
        onPaid={() => { setSelectedKeys([]); setSelectedRows([]); load(); }}
      />

      <Modal
        open={!!backfill} onCancel={() => setBackfill(null)} onOk={runBackfill} okText="Add commission"
        title="Commission for older payments"
      >
        {backfill && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Commission was off (or not there) when some payments came in. This adds them at the agent&apos;s
              <b> current rates</b> ({commissionSummaryText(cfg)}). Payments already counted are skipped.
              {programName ? <> Only <b>{programName}</b>.</> : null}
            </p>
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">Payment date (empty = all)</div>
              <RangePicker className="w-full" value={backfill.range} format="DD-MM-YYYY" allowEmpty={[true, true]}
                onChange={(v) => setBackfill((b) => ({ ...b, range: v }))} />
            </div>
            <Checkbox.Group value={backfill.sources} onChange={(v) => setBackfill((b) => ({ ...b, sources: v }))}
              options={[{ label: "Join fees", value: "join_fees" }, { label: "Closing payments", value: "closing" }]} />
          </div>
        )}
      </Modal>
    </div>
  );
}
