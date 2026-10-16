"use client";
// Closed Members: every member whose closing (marriage) is recorded, with the payment
// progress of that closing (how many payers paid / pending, amount collected / due).
// Filters: closing date range, closing group, agent, payment status, search.
// Per member: pay status of all payers, closing form PDF, banner, banner data.
// Whole list: PDF, CSV, and "all members payment status".
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSelector } from "react-redux";
import { App, Avatar, Button, DatePicker, Drawer, Dropdown, Empty, Input, Select, Table, Tag, Tooltip } from "antd";
import { UserOutlined } from "@ant-design/icons";
import {
  FiHeart, FiRefreshCw, FiDownload, FiFileText, FiImage, FiDollarSign, FiUsers, FiSearch,
  FiCheckCircle, FiClock, FiAlertCircle, FiMoreVertical, FiEdit3, FiX, FiList,
} from "react-icons/fi";
import dayjs from "dayjs";
import { api } from "@/lib/client/api";
import { useAuth, useFeature } from "@/lib/AuthProvider";
import { fetchAllMembers } from "@/lib/services/firebaseService";
import ClosingPendingPayment from "@/components/screen/home/ClosingMember/ClosingPendingPayment";
import EditPdfDataForm from "@/components/screen/home/ClosingMember/EditPdfDataForm";
import { amountsHidden, useAmountsHidden, MASK, AmountsEye } from "@/lib/client/privacy";

// react-pdf parts only in the browser
const ClosingFormPdfDraver = dynamic(() => import("@/components/screen/home/ClosingMember/ClosingFormPdfDraver"), { ssr: false });
const ClosingBannerImageDrawer = dynamic(() => import("@/components/screen/home/ClosingMember/ClosingBannerImageDrawer"), { ssr: false });
const AllClosingPendingPayment = dynamic(() => import("@/components/screen/home/ClosingMember/AllClosingPendingPayment"), { ssr: false });
const ReceiptsDrawer = dynamic(() => import("@/components/common/receipts/ReceiptsDrawer"), { ssr: false });
const ClosedMembersPdfDrawer = dynamic(() => import("@/components/screen/closedMembers/ClosedMembersPdfDrawer"), { ssr: false });

const { RangePicker } = DatePicker;
const C = { good: "#0ca30c", warn: "#fab219", bad: "#d03b3b", blue: "#2a78d6", violet: "#6250d6", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", track: "#efeee9" };
const inr = (n) => (amountsHidden() ? MASK : "₹" + Number(n || 0).toLocaleString("en-IN")); // hidden until the eye is clicked
const num = (n) => Number(n || 0).toLocaleString("en-IN");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

const PAY_FILTERS = [
  { value: "all", label: "All payment status" },
  { value: "complete", label: "Fully collected" },
  { value: "pending", label: "Payment pending" },
  { value: "none", label: "No payers" },
];

function payState(r) {
  if (!r.totalDues) return { key: "none", label: "No payers", color: "default", icon: <FiAlertCircle /> };
  if (!r.pending && !r.partial) return { key: "complete", label: "Collected", color: "success", icon: <FiCheckCircle /> };
  return { key: "pending", label: "Pending", color: "warning", icon: <FiClock /> };
}

const Stat = ({ icon: Icon, label, value, sub, color }) => (
  <div className="cm-stat">
    <div className="flex items-center gap-2">
      <span className="cm-ic" style={{ color, background: color + "1a" }}><Icon size={14} /></span>
      <span className="cm-stat-label">{label}</span>
    </div>
    <div className="cm-stat-value">{value}</div>
    {sub ? <div className="cm-stat-sub">{sub}</div> : null}
  </div>
);

const Meter = ({ value, color = C.blue, height = 6 }) => (
  <div className="w-full rounded-full overflow-hidden" style={{ height, background: C.track }}>
    <div style={{ width: `${Math.max(0, Math.min(100, value || 0))}%`, height: "100%", background: color, borderRadius: 999 }} />
  </div>
);

export default function ClosedMembersPage() {
  useAmountsHidden(); // re-render on show / hide amounts
  const { message } = App.useApp();
  const { user } = useAuth();
  const feature = useFeature();
  const program = useSelector((s) => s.data.selectedProgram);
  const agentsList = useSelector((s) => s.data.agentsList) || [];
  const groups = useSelector((s) => s.data.closingGroupList) || [];
  const TrustData = useSelector((s) => s.data.trustData);

  const [range, setRange] = useState(null);
  const [groupId, setGroupId] = useState();
  const [agentId, setAgentId] = useState();
  const [payFilter, setPayFilter] = useState("all");
  const [q, setQ] = useState("");

  const [rows, setRows] = useState([]);
  const [legacy, setLegacy] = useState({});   // id → full member record for the drawers
  const [loading, setLoading] = useState(false);

  const [current, setCurrent] = useState(null); // legacy record of the row being acted on
  const [open, setOpen] = useState({ pay: false, form: false, banner: false, edit: false, all: false, pdf: false, receipts: false });
  const show = (k, v = true) => setOpen((o) => ({ ...o, [k]: v }));

  const load = useCallback(async () => {
    if (!program?.id) return;
    setLoading(true);
    try {
      const query = {
        from: range?.[0] ? range[0].format("YYYY-MM-DD") : undefined,
        to: range?.[1] ? range[1].format("YYYY-MM-DD") : undefined,
        closingGroupId: groupId,
        closingAgentId: agentId,
      };
      const [list, members] = await Promise.all([
        api.get(`/programs/${program.id}/closings`, query),
        fetchAllMembers(program.id, { closed: "true" }),
      ]);
      setRows(list.closings || []);
      setLegacy(Object.fromEntries(members.map((m) => [m.id, m])));
    } catch (e) {
      message.error(e.message || "Failed to load closed members");
    } finally {
      setLoading(false);
    }
  }, [program?.id, range, groupId, agentId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setGroupId(undefined); setAgentId(undefined); }, [program?.id]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (payFilter !== "all" && payState(r).key !== payFilter) return false;
      if (!s) return true;
      return [r.displayName, r.fatherName, r.registrationNumber, r.applicationNumber, r.village, r.phone, r.agentName]
        .filter(Boolean).join(" ").toLowerCase().includes(s);
    });
  }, [rows, q, payFilter]);

  const summary = useMemo(() => filtered.reduce((s, r) => {
    s.totalClosings++;
    s.totalPayers += r.totalDues;
    s.totalPaidCount += r.paid;
    s.totalPendingCount += r.pending + r.partial;
    s.totalCollected += r.collectedAmount;
    s.totalPendingAmount += r.pendingAmount;
    if (payState(r).key === "complete") s.complete++;
    return s;
  }, { totalClosings: 0, totalPayers: 0, totalPaidCount: 0, totalPendingCount: 0, totalCollected: 0, totalPendingAmount: 0, complete: 0 }), [filtered]);

  const filtersText = [
    range ? `${range[0].format("DD-MM-YYYY")} से ${range[1].format("DD-MM-YYYY")}` : null,
    groupId ? `ग्रुप: ${groupId === "none" ? "बिना ग्रुप" : groups.find((g) => g.id === groupId)?.name || groupId}` : null,
    agentId ? `एजेंट: ${agentId === "none" ? "बिना एजेंट" : agentsList.find((a) => a.id === agentId)?.displayName || agentId}` : null,
    payFilter !== "all" ? PAY_FILTERS.find((p) => p.value === payFilter)?.label : null,
    q ? `खोज: "${q}"` : null,
  ].filter(Boolean).join("  •  ");

  const anyFilter = range || groupId || agentId || payFilter !== "all" || q;
  const clearFilters = () => { setRange(null); setGroupId(undefined); setAgentId(undefined); setPayFilter("all"); setQ(""); };

  const act = (r, k) => {
    const rec = legacy[r.id];
    if (!rec) { message.warning("Member record not loaded yet — press Refresh"); return; }
    setCurrent(rec);
    show(k);
  };

  const savePdfData = async (updated) => {
    try {
      await api.patch(`/members/${current.id}/closing`, { pdfData: { ...updated, updatedAt: new Date().toISOString() } });
      message.success("Banner data saved");
      show("edit", false);
      load();
    } catch {
      message.error("Failed to save banner data");
    }
  };

  const exportCsv = () => {
    const head = ["#", "Reg No", "Name", "Father", "Village", "Phone", "Closing date", "Group", "Agent", "Payers", "Paid", "Pending", "Collected", "Due", "Progress %"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = filtered.map((r, i) => [i + 1, r.registrationNumber, r.displayName, r.fatherName, r.village, r.phone, r.closingDate, r.closingGroupName, r.agentName,
      r.totalDues, r.paid, r.pending + r.partial, r.collectedAmount, r.pendingAmount, pct(r.collectedAmount, r.collectedAmount + r.pendingAmount)].map(esc).join(","));
    const blob = new Blob(["﻿" + [head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `closed-members-${dayjs().format("YYYY-MM-DD")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const columns = [
    {
      title: "Closed member", dataIndex: "displayName", width: 220, fixed: "left",
      sorter: (a, b) => (a.displayName || "").localeCompare(b.displayName || ""),
      render: (v, r) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar src={r.photoUrl || undefined} icon={<UserOutlined />} size={38} />
          <div className="min-w-0">
            <div className="font-semibold truncate" style={{ color: C.ink }}>{v}</div>
            <div className="text-xs truncate" style={{ color: C.muted }}>
              <span className="cm-reg">{r.registrationNumber || "—"}</span>
              {r.fatherName ? ` · ${r.fatherName}` : ""}{r.village ? ` · ${r.village}` : ""}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Closing", dataIndex: "closingDate", width: 140, defaultSortOrder: "descend",
      sorter: (a, b) => (a.closingDate || "").localeCompare(b.closingDate || ""),
      render: (v, r) => (
        <div>
          <div style={{ color: C.ink, fontWeight: 600 }}>{v ? dayjs(v).format("DD MMM YYYY") : "—"}</div>
          {r.closingGroupName
            ? <Tag className="mt-1" color="purple" bordered={false}>{r.closingGroupName}</Tag>
            : <span className="text-xs" style={{ color: C.muted }}>No group</span>}
        </div>
      ),
    },
    {
      title: "Agent", dataIndex: "agentName", width: 140,
      sorter: (a, b) => (a.agentName || "").localeCompare(b.agentName || ""),
      render: (v, r) => v
        ? <div><div className="truncate" style={{ color: C.ink }}>{v}</div><div className="text-xs" style={{ color: C.muted }}>{r.agentPhone || ""}</div></div>
        : <span style={{ color: C.muted }}>Admin</span>,
    },
    {
      title: "Payers", dataIndex: "totalDues", width: 165,
      sorter: (a, b) => a.totalDues - b.totalDues,
      render: (v, r) => (
        <div className="text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
          <div style={{ color: C.ink }}><b>{num(v)}</b> total</div>
          <div className="whitespace-nowrap mt-0.5">
            <span style={{ color: C.good }}>✓ {num(r.paid)} paid</span>
            <span className="ml-2" style={{ color: r.pending + r.partial ? C.bad : C.muted }}>● {num(r.pending + r.partial)} pending</span>
          </div>
        </div>
      ),
    },
    {
      title: "Collected / Due", key: "money", width: 230,
      sorter: (a, b) => pct(a.collectedAmount, a.collectedAmount + a.pendingAmount) - pct(b.collectedAmount, b.collectedAmount + b.pendingAmount),
      render: (_, r) => {
        const st = payState(r);
        const p = pct(r.collectedAmount, r.collectedAmount + r.pendingAmount);
        return (
          <div style={{ fontVariantNumeric: "tabular-nums" }}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span><b style={{ color: C.ink }}>{inr(r.collectedAmount)}</b>{r.pendingAmount ? <span className="text-xs" style={{ color: C.bad }}> · {inr(r.pendingAmount)} due</span> : null}</span>
              <Tag color={st.color} bordered={false} className="!m-0">{st.key === "pending" ? `${p}%` : st.label}</Tag>
            </div>
            <Meter value={p} color={st.key === "complete" ? C.good : C.blue} />
          </div>
        );
      },
    },
    {
      title: "Actions", key: "actions", width: 150, fixed: "right",
      render: (_, r) => (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Tooltip title="Pay status of all payers"><Button size="small" type="primary" ghost icon={<FiDollarSign />} onClick={() => act(r, "pay")} /></Tooltip>
          <Tooltip title="Closing form PDF"><Button size="small" icon={<FiFileText />} onClick={() => act(r, "form")} /></Tooltip>
          <Tooltip title="Banner image"><Button size="small" icon={<FiImage />} onClick={() => act(r, "banner")} /></Tooltip>
          <Dropdown trigger={["click"]} menu={{
            items: [{ key: "edit", icon: <FiEdit3 />, label: "Edit banner / PDF data" }],
            onClick: ({ key }) => act(r, key),
          }}>
            <Button size="small" icon={<FiMoreVertical />} />
          </Dropdown>
        </div>
      ),
    },
  ];

  const filteredLegacy = filtered.map((r) => legacy[r.id]).filter(Boolean);

  return (
    <div className="cm">
      <style>{CSS}</style>

      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="cm-title">Closed Members</h1>
          <p className="cm-sub">Closings recorded in {program?.name || "—"} and how much of each has been collected</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {feature("receipts") && <Button icon={<FiFileText />} onClick={() => show("receipts")}>Receipts (रसीद)</Button>}
          <Button icon={<FiList />} onClick={() => show("all")} disabled={!filteredLegacy.length}>All members payment status</Button>
          <Button icon={<FiDownload />} onClick={exportCsv} disabled={!filtered.length}>CSV</Button>
          <Button type="primary" icon={<FiFileText />} onClick={() => show("pdf")} disabled={!filtered.length}>Download PDF</Button>
        </div>
      </div>

      {/* stats */}
      <div className="cm-stats">
        <Stat icon={FiHeart} label="Closed members" value={num(summary.totalClosings)} color={C.violet}
          sub={`${num(summary.complete)} fully collected`} />
        <Stat icon={FiUsers} label="Payer entries" value={num(summary.totalPayers)} color={C.ink2}
          sub={`${num(summary.totalPaidCount)} paid · ${num(summary.totalPendingCount)} pending`} />
        <Stat icon={FiCheckCircle} label="Collected" value={inr(summary.totalCollected)} color={C.good} />
        <Stat icon={FiClock} label="Due" value={inr(summary.totalPendingAmount)} color={C.bad}
          sub={`${num(filtered.filter((r) => payState(r).key === "pending").length)} closings pending`} />
        <div className="cm-stat">
          <div className="flex items-center justify-between">
            <span className="cm-stat-label">Overall progress</span>
            <b style={{ color: C.ink }}>{pct(summary.totalCollected, summary.totalCollected + summary.totalPendingAmount)}%</b>
          </div>
          <div className="mt-4"><Meter value={pct(summary.totalCollected, summary.totalCollected + summary.totalPendingAmount)} height={10} /></div>
          <div className="cm-stat-sub mt-2">{inr(summary.totalCollected)} of {inr(summary.totalCollected + summary.totalPendingAmount)}</div>
        </div>
      </div>

      {/* filters */}
      <div className="cm-card p-3 flex flex-wrap items-center gap-2">
        <RangePicker value={range} onChange={setRange} format="DD-MM-YYYY" allowClear placeholder={["Closing from", "Closing to"]}
          presets={[
            { label: "This month", value: [dayjs().startOf("month"), dayjs().endOf("month")] },
            { label: "Last month", value: [dayjs().subtract(1, "month").startOf("month"), dayjs().subtract(1, "month").endOf("month")] },
            { label: "Last 3 months", value: [dayjs().subtract(3, "month").startOf("day"), dayjs()] },
            { label: "This year", value: [dayjs().startOf("year"), dayjs().endOf("year")] },
          ]} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="All closing groups" value={groupId} onChange={setGroupId} style={{ minWidth: 190 }}
          options={[{ value: "none", label: "No group" }, ...groups.map((g) => ({ value: g.id, label: g.name || g.groupName || g.id }))]} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="All agents" value={agentId} onChange={setAgentId} style={{ minWidth: 190 }}
          options={[{ value: "none", label: "No agent (admin)" }, ...agentsList.map((a) => ({ value: a.id, label: a.displayName || a.name || a.id }))]} />
        <Select value={payFilter} onChange={setPayFilter} style={{ minWidth: 180 }} options={PAY_FILTERS} />
        <Input allowClear prefix={<FiSearch className="text-gray-400" />} placeholder="Name, reg no, village, phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <div className="flex-1" />
        {anyFilter && <Button type="text" icon={<FiX />} onClick={clearFilters}>Clear filters</Button>}
        <Button icon={<FiRefreshCw className={loading ? "animate-spin" : ""} />} onClick={load}>Refresh</Button>
      </div>

      {/* table */}
      <div className="cm-card p-2">
        <Table
          rowKey="id" size="middle" loading={loading} columns={columns} dataSource={filtered}
          scroll={{ x: 1045 }}
          pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: [25, 50, 100], showTotal: (t) => `${t} closed members` }}
          onRow={(r) => ({ onDoubleClick: () => act(r, "pay") })}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={anyFilter ? "No closed member matches these filters" : "No closings recorded yet"} /> }}
        />
      </div>

      {/* pay status of all payers for one closing */}
      <Drawer
        title={current ? `Payment status — ${current.displayName} (${current.registrationNumber || ""})` : "Payment status"}
        open={open.pay} onClose={() => show("pay", false)} destroyOnClose
        width={typeof window !== "undefined" ? Math.min(1100, window.innerWidth - 20) : 1100}
      >
        {open.pay && current && <ClosingPendingPayment selectedRecord={current} />}
      </Drawer>

      {current && (
        <ClosingFormPdfDraver
          open={open.form} setOpen={(v) => show("form", v)} memberData={current}
          selectedProgram={program} closingMembers={filteredLegacy} user={user}
        />
      )}
      {current && open.banner && (
        <ClosingBannerImageDrawer
          open={open.banner} onClose={() => show("banner", false)} memberData={current}
          selectedProgram={program} TrustData={TrustData}
        />
      )}
      {current && open.edit && (
        <EditPdfDataForm
          open={open.edit} onClose={() => show("edit", false)} memberData={current}
          selectedProgram={program} onSave={savePdfData} user={user}
        />
      )}
      {open.all && (
        <AllClosingPendingPayment open={open.all} setOpen={(v) => show("all", v)} closingMemberList={filteredLegacy} />
      )}
      {open.receipts && (
        <ReceiptsDrawer
          open={open.receipts} onClose={() => show("receipts", false)}
          defaults={{
            closingGroupId: groupId,
            from: range?.[0] ? range[0].format("YYYY-MM-DD") : undefined,
            to: range?.[1] ? range[1].format("YYYY-MM-DD") : undefined,
          }}
        />
      )}
      {open.pdf && (
        <ClosedMembersPdfDrawer
          open={open.pdf} onClose={() => show("pdf", false)}
          fileName={`closed-members-${dayjs().format("YYYY-MM-DD")}.pdf`}
          rows={filtered} summary={summary} filtersText={filtersText} programName={program?.name} TrustData={TrustData}
        />
      )}
    </div>
  );
}

const CSS = `
.cm { display: flex; flex-direction: column; gap: 14px; }
.cm-title { font-size: 22px; font-weight: 800; color: #0b0b0b; letter-spacing: -0.02em; }
.cm-sub { font-size: 13px; color: #52514e; margin-top: 2px; }
.cm-card { background: #fff; border: 1px solid rgba(11,11,11,0.08); border-radius: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
.cm-stats { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
@media (max-width: 640px) { .cm-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.cm-stat { background: #fff; border: 1px solid rgba(11,11,11,0.08); border-radius: 16px; padding: 14px 16px; min-width: 0; }
.cm-ic { width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; }
.cm-stat-label { font-size: 12px; font-weight: 600; color: #52514e; white-space: nowrap; }
.cm-stat-value { font-size: 24px; font-weight: 800; color: #0b0b0b; letter-spacing: -0.02em; margin-top: 8px; line-height: 1.15; }
.cm-stat-sub { font-size: 11.5px; color: #898781; margin-top: 3px; }
.cm-reg { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #52514e; }
.cm .ant-table-thead th { white-space: nowrap; }
`;
