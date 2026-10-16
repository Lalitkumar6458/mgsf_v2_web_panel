"use client";
// Receipts (रसीद) — generate pending / paid receipts for a closing group, a closing date range,
// one agent or all agents, and follow the background job (big runs come in parts).
// Used by: Closed Members page, Agent → Members Pay Status.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { App, Button, DatePicker, Drawer, Empty, InputNumber, Input, Progress, Segmented, Select, Tag, Tooltip } from "antd";
import { FiDownload, FiExternalLink, FiFileText, FiRefreshCw, FiClock, FiCheckCircle, FiAlertTriangle, FiLoader } from "react-icons/fi";
import dayjs from "dayjs";
import { api } from "@/lib/client/api";
import { waUrl, receiptText } from "@/lib/client/whatsapp";
import { useFeature } from "@/lib/AuthProvider";

const { RangePicker } = DatePicker;

const STATE = {
  queued: { color: "default", label: "Waiting", icon: <FiClock /> },
  running: { color: "processing", label: "Making PDF", icon: <FiLoader className="animate-spin" /> },
  done: { color: "success", label: "Ready", icon: <FiCheckCircle /> },
  error: { color: "error", label: "Failed", icon: <FiAlertTriangle /> },
};

function JobCard({ job, groups, agents, trustName, waOn }) {
  const [showShares, setShowShares] = useState(false);
  const done = job.parts.filter((p) => p.status === "done").length;
  const pct = Math.round((done / job.parts.length) * 100);
  const st = STATE[job.state] || STATE.queued;
  const f = job.filters || {};
  const filterText = [
    f.closingGroupId ? (f.closingGroupId === "none" ? "No group" : groups.find((g) => g.id === f.closingGroupId)?.name || "Group") : null,
    f.from || f.to ? `${f.from ? dayjs(f.from).format("DD-MM-YY") : "…"} → ${f.to ? dayjs(f.to).format("DD-MM-YY") : "…"}` : null,
    f.agentId ? (f.agentId === "none" ? "No agent" : agents.find((a) => a.id === f.agentId)?.displayName || "Agent") : "All agents",
    f.members ? `${f.members} chosen members` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="rounded-xl border border-gray-200 p-3.5 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 truncate">{job.label}</div>
          <div className="text-xs text-gray-500 mt-0.5">{filterText}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {job.totals.members} receipts · {job.totals.rows} entries · ~{job.totals.pages} pages · {dayjs(job.createdAt).format("DD MMM, hh:mm A")}
          </div>
        </div>
        <Tag color={st.color} icon={st.icon} className="!m-0 inline-flex items-center gap-1 shrink-0">{st.label}</Tag>
      </div>
      {job.state !== "done" && job.state !== "error" && (
        <div className="mt-2">
          <Progress percent={pct} size="small" status="active" format={() => `${done}/${job.parts.length}`} />
          <div className="text-[11px] text-gray-500">
            {job.queuePosition > 0 ? `${job.queuePosition} run(s) ahead in the queue · ` : ""}
            {job.etaSeconds > 0 ? `about ${job.etaSeconds < 90 ? `${job.etaSeconds} sec` : `${Math.round(job.etaSeconds / 60)} min`} left` : ""}
          </div>
        </div>
      )}
      {job.error && <div className="text-xs text-red-600 mt-2">{job.error}</div>}
      {waOn && job.shares?.length > 0 && (
        <div className="mt-2">
          <button type="button" className="text-xs font-semibold text-green-700" onClick={() => setShowShares((v) => !v)}>
            {showShares ? "▾" : "▸"} WhatsApp pe rasid ka link bhejein ({job.shares.length})
          </button>
          {showShares && (
            <div className="mt-1.5 max-h-64 overflow-y-auto space-y-1">
              {job.shares.map((s) => {
                const url = waUrl(s.phone, receiptText({ name: s.name, trustName, receiptNo: s.receiptNo, amount: s.amount, verifyUrl: s.verifyUrl }));
                return (
                  <div key={s.receiptNo} className="flex items-center gap-2 text-xs rounded-lg bg-green-50 px-2.5 py-1.5">
                    <span className="font-mono text-gray-500 w-14 shrink-0">{s.receiptNo}</span>
                    <span className="truncate flex-1">{s.name}</span>
                    <span className="tabular-nums text-gray-600">₹{s.amount.toLocaleString("en-IN")}</span>
                    {url ? <Button size="small" href={url} target="_blank" style={{ color: "#15803d", borderColor: "#86efac" }}>Bhejein</Button> : <span className="text-gray-400">no mobile</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div className="mt-2.5 space-y-1.5">
        {job.parts.map((p) => (
          <div key={p.n} className="flex items-center gap-2 text-xs rounded-lg bg-gray-50 px-2.5 py-1.5">
            <span className="font-semibold text-gray-700 w-14 shrink-0">Part {p.n}</span>
            <span className="text-gray-500 truncate flex-1">
              रसीद {p.receiptFrom}–{p.receiptTo} · {p.members} members · {p.pages} pages
              {p.firstMember ? ` · ${p.firstMember}${p.lastMember && p.lastMember !== p.firstMember ? ` … ${p.lastMember}` : ""}` : ""}
            </span>
            {p.status === "done" ? (
              <span className="flex gap-1 shrink-0">
                <Tooltip title="Open"><Button size="small" icon={<FiExternalLink />} href={p.url} target="_blank" /></Tooltip>
                <Tooltip title="Download"><Button size="small" type="primary" icon={<FiDownload />} href={`${p.url}?download=1`} /></Tooltip>
              </span>
            ) : (
              <Tag className="!m-0" color={p.status === "running" ? "processing" : p.status === "error" ? "error" : "default"}>
                {p.status === "running" ? "making…" : p.status}
              </Tag>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * props:
 *  open, onClose
 *  defaults: { status, agentId, closingGroupId, from, to, memberIds, receiptStartNo, label }
 *  lockAgent: hide the agent picker (agent page)
 *  autoStart: start immediately with `defaults` (used by "Generate receipts" buttons)
 */
export default function ReceiptsDrawer({ open, onClose, defaults = {}, lockAgent = false, autoStart = false, agentInfo }) {
  const { message } = App.useApp();
  const program = useSelector((s) => s.data.selectedProgram);
  const groups = useSelector((s) => s.data.closingGroupList) || [];
  const agents = useSelector((s) => s.data.agentsList) || [];
  const trust = useSelector((s) => s.data.trustData);
  const waOn = useFeature()("whatsapp");

  const [status, setStatus] = useState(defaults.status || "pending");
  const [groupId, setGroupId] = useState(defaults.closingGroupId);
  const [range, setRange] = useState(defaults.from || defaults.to ? [defaults.from ? dayjs(defaults.from) : null, defaults.to ? dayjs(defaults.to) : null] : null);
  const [agentId, setAgentId] = useState(defaults.agentId);
  const [startNo, setStartNo] = useState(defaults.receiptStartNo || 1);
  const [prefix, setPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState([]);
  const started = useRef(false);
  const memberIds = defaults.memberIds;

  const loadJobs = useCallback(async () => {
    if (!program?.id) return;
    try { setJobs((await api.get("/receipts/jobs", { programId: program.id })).jobs || []); } catch { /* ignore */ }
  }, [program?.id]);

  // poll while something is running
  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  useEffect(() => {
    if (!open) return;
    loadJobs();
    const t = setInterval(() => {
      if (jobsRef.current.some((j) => j.state === "queued" || j.state === "running")) loadJobs();
    }, 2500);
    return () => clearInterval(t);
  }, [open, loadJobs]);

  const start = useCallback(async (override = {}) => {
    if (!program?.id) return;
    setBusy(true);
    try {
      const st = override.status || status;
      const body = {
        status: st,
        agentId: lockAgent ? defaults.agentId : agentId,
        closingGroupId: groupId,
        from: range?.[0] ? range[0].format("YYYY-MM-DD") : undefined,
        to: range?.[1] ? range[1].format("YYYY-MM-DD") : undefined,
        memberIds,
        receiptStartNo: startNo,
        receiptPrefix: prefix,
        agentInfo,
        label: defaults.label
          ? `${defaults.label} · ${st === "paid" ? "Paid" : "Pending"}`
          : `${st === "paid" ? "Paid" : "Pending"} receipts · ${program.name}`,
      };
      const { job } = await api.post(`/programs/${program.id}/receipts`, body);
      setJobs((j) => [job, ...j.filter((x) => x.id !== job.id)]);
      message.success(`${job.totals.members} receipts queued${job.parts.length > 1 ? ` in ${job.parts.length} parts` : ""}`);
    } catch (e) {
      message.error(e.message || "Could not start receipts");
    } finally {
      setBusy(false);
    }
  }, [program, status, lockAgent, defaults.agentId, defaults.label, agentId, groupId, range, memberIds, startNo, prefix, agentInfo, message]);

  useEffect(() => {
    if (open && autoStart && !started.current) { started.current = true; start({ status: defaults.status }); }
    if (!open) started.current = false;
  }, [open, autoStart, start, defaults.status]);

  const groupOptions = useMemo(() => [{ value: "none", label: "No group" }, ...groups.map((g) => ({ value: g.id, label: g.name || g.id }))], [groups]);

  return (
    <Drawer
      title={<span className="flex items-center gap-2"><FiFileText /> Receipts (रसीद)</span>}
      open={open} onClose={onClose}
      width={typeof window !== "undefined" ? Math.min(620, window.innerWidth) : 620}
      extra={<Tooltip title="Refresh"><Button icon={<FiRefreshCw />} onClick={loadJobs} /></Tooltip>}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 p-4 space-y-3 bg-gray-50/60">
          <Segmented block value={status} onChange={setStatus}
            options={[{ value: "pending", label: "Pending (बकाया) receipts" }, { value: "paid", label: "Paid (भुगतान) receipts" }]} />
          {memberIds?.length ? (
            <div className="text-sm text-gray-600">For <b>{memberIds.length}</b> chosen members{defaults.label ? ` · ${defaults.label}` : ""}.</div>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">Closing group</div>
              <Select allowClear showSearch optionFilterProp="label" className="w-full" placeholder="All closings" value={groupId} onChange={setGroupId} options={groupOptions} />
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">Closing date</div>
              <RangePicker className="w-full" value={range} onChange={setRange} format="DD-MM-YYYY" allowEmpty={[true, true]}
                presets={[
                  { label: "This month", value: [dayjs().startOf("month"), dayjs().endOf("month")] },
                  { label: "Last month", value: [dayjs().subtract(1, "month").startOf("month"), dayjs().subtract(1, "month").endOf("month")] },
                  { label: "Last 3 months", value: [dayjs().subtract(3, "month"), dayjs()] },
                ]} />
            </div>
            {!lockAgent && (
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-1">Agent (of the payer)</div>
                <Select allowClear showSearch optionFilterProp="label" className="w-full" placeholder="All agents" value={agentId} onChange={setAgentId}
                  options={[{ value: "none", label: "No agent (admin)" }, ...agents.map((a) => ({ value: a.id, label: a.displayName || a.id }))]} />
              </div>
            )}
            <div className="flex gap-2">
              <div className="flex-1">
                <div className="text-xs font-semibold text-gray-500 mb-1">First रसीद no.</div>
                <InputNumber min={1} className="w-full" value={startNo} onChange={(v) => setStartNo(v || 1)} />
              </div>
              <div className="w-24">
                <div className="text-xs font-semibold text-gray-500 mb-1">Prefix</div>
                <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={12} placeholder="MG/" />
              </div>
            </div>
          </div>
          <Button type="primary" block size="large" loading={busy} icon={<FiFileText />} onClick={() => start()}>
            Generate {status === "paid" ? "paid" : "pending"} receipts
          </Button>
          <div className="text-[11px] text-gray-500 leading-relaxed">
            One receipt per member, only the closings that match. Big runs are made in parts of about 300 pages in the
            background — the rest of the app keeps working. Files stay here for 24 hours.
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recent runs</div>
          {jobs.length === 0
            ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No receipts made in the last 24 hours" />
            : jobs.map((j) => <JobCard key={j.id} job={j} groups={groups} agents={agents} trustName={trust?.name} waOn={waOn} />)}
        </div>
      </div>
    </Drawer>
  );
}
