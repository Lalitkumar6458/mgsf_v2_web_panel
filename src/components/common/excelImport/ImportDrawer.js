"use client";
// Members page → "Import": Excel / CSV se sadasya + purani closing + jama payment.
//   1. sample download  2. file daalein → jaanch (row-wise galtiyan, preview)  3. Import → live progress → result (passwords, undo)
import { useCallback, useEffect, useRef, useState } from "react";
import { App, Alert, Button, Checkbox, Drawer, Empty, Popconfirm, Progress, Space, Statistic, Table, Tabs, Tag, Upload } from "antd";
import { FiDownload, FiUploadCloud, FiCheckCircle, FiAlertTriangle, FiRotateCcw, FiFileText, FiKey, FiTrash2, FiArrowLeft } from "react-icons/fi";
import { api } from "@/lib/client/api";

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const STEP_COLOR = { wait: "#d1d5db", run: "#2563eb", done: "#16a34a", fail: "#dc2626" };
const STATUS = { running: ["processing", "Chal raha"], done: ["success", "Poora"], failed: ["error", "Ruk gaya"] };

export default function ImportDrawer({ open, programId, programName, onClose, onDone }) {
  const { message } = App.useApp();
  const [stage, setStage] = useState("pick"); // pick | check | run
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState(null);
  const [skipBad, setSkipBad] = useState(false);
  const [job, setJob] = useState(null);
  const [past, setPast] = useState([]);
  const timer = useRef(null);
  const base = `/programs/${programId}/import`;

  const loadPast = useCallback(() => api.get(base).then((r) => setPast(r.imports || [])).catch(() => {}), [base]);
  useEffect(() => { if (open) loadPast(); }, [open, loadPast]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const poll = useCallback(async (id) => {
    clearTimeout(timer.current);
    try {
      const { job: j } = await api.get(`${base}/${id}`);
      setJob(j);
      if (j.status === "running") timer.current = setTimeout(() => poll(id), 1200);
      else { loadPast(); onDone?.(); }
    } catch (e) { message.error(e.message); }
  }, [base, loadPast, onDone, message]);

  const reset = () => { clearTimeout(timer.current); setStage("pick"); setCheck(null); setJob(null); setSkipBad(false); };
  const close = () => { reset(); onClose?.(); };

  const upload = async (file) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post(`${base}/check`, fd);
      setCheck(r); setStage("check"); setSkipBad(false);
    } catch (e) { message.error(e.message); }
    setBusy(false);
    return false;
  };
  const start = async () => {
    setBusy(true);
    try {
      const { jobId } = await api.post(base, { token: check.token, skipErrorRows: skipBad });
      setStage("run"); poll(jobId);
    } catch (e) { message.error(e.message); }
    setBusy(false);
  };
  const act = async (action) => {
    try {
      const r = await api.post(`${base}/${job.id}`, { action });
      message.success(action === "undo" ? `${r.removed} members hata diye` : "Passwords delete");
      poll(job.id); onDone?.();
    } catch (e) { message.error(e.message); }
  };
  const openPast = (row) => { setStage("run"); poll(row.id); };

  const s = check?.summary;
  const errCount = check?.errors?.length || 0;
  const rep = job?.report || {};

  return (
    <Drawer open={open} onClose={close} width={Math.min(960, typeof window !== "undefined" ? window.innerWidth : 960)} destroyOnClose
      title={<div><div className="font-semibold">Excel / CSV import</div><div className="text-xs font-normal text-gray-500">{programName}</div></div>}
      extra={stage !== "pick" && (stage !== "run" || job?.status !== "running") ? <Button icon={<FiArrowLeft />} onClick={reset}>Nayi file</Button> : null}>

      {stage === "pick" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="mb-1 font-semibold text-blue-900">1 · Sample file lein</div>
            <p className="mb-3 text-sm text-blue-900/80">
              Excel mein do sheet: <b>Members</b> (har sadasya ki ek line — purani closing ho to Status <i>closed</i> + Closing date) aur <b>Payments</b> (jo closing payment pehle se jama hain).
              Help sheet mein har column ka matlab hai. Reg. No. khaali chhodenge to apne aap banega; login aur dues bhi apne aap.
            </p>
            <Space wrap>
              <Button type="primary" icon={<FiDownload />} href={`/api${base}/sample`}>Sample Excel (.xlsx)</Button>
              <Button icon={<FiFileText />} href={`/api${base}/sample?format=csv&sheet=members`}>Members CSV</Button>
              <Button icon={<FiFileText />} href={`/api${base}/sample?format=csv&sheet=payments`}>Payments CSV</Button>
            </Space>
          </div>
          <div>
            <div className="mb-2 font-semibold">2 · Bhari hui file daalein</div>
            <Upload.Dragger accept=".xlsx,.csv" showUploadList={false} beforeUpload={upload} disabled={busy}>
              <p className="text-3xl text-blue-600"><FiUploadCloud className="mx-auto" /></p>
              <p className="font-medium">{busy ? "Jaanch ho rahi hai…" : "Yahan .xlsx / .csv file chhodein ya click karein"}</p>
              <p className="text-xs text-gray-500">Pehle sirf jaanch hogi — kuch save nahi hoga. Max 15 MB.</p>
            </Upload.Dragger>
          </div>
          <PastImports rows={past} onOpen={openPast} />
        </div>
      )}

      {stage === "check" && check && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat title="Members" value={s.members} />
            <Stat title="Purani closing" value={s.closed} />
            <Stat title="Join fee jama" value={inr(s.joinFees)} />
            <Stat title="Payments" value={`${s.payments} · ${inr(s.paymentAmount)}`} />
            <Stat title="Galtiyan" value={errCount} danger={errCount > 0} />
          </div>
          {errCount ? (
            <Alert type="error" showIcon icon={<FiAlertTriangle />} message={`${errCount} galtiyan mili`}
              description="File theek karke dobara daalein — ya neeche 'galat lines chhod do' chunein (baaki lines import hongi)." />
          ) : (
            <Alert type="success" showIcon icon={<FiCheckCircle />} message="File theek hai — import ke liye taiyaar" />
          )}
          <Tabs items={[
            ...(errCount ? [{ key: "e", label: <span className="text-red-600">Galtiyan ({errCount})</span>, children: (
              <Table size="small" rowKey={(r, i) => i} dataSource={check.errors} pagination={{ pageSize: 20 }}
                columns={[{ title: "Sheet", dataIndex: "sheet", width: 90 }, { title: "Line", dataIndex: "row", width: 60 }, { title: "Column", dataIndex: "column", width: 160 }, { title: "Galti", dataIndex: "message" }]} />) }] : []),
            { key: "m", label: `Members (${s.members})`, children: (
              <Table size="small" rowKey="row" dataSource={check.members} scroll={{ x: 900 }} pagination={{ pageSize: 20 }}
                rowClassName={(r) => (check.errors.some((e) => e.sheet === "Members" && e.row === r.row) ? "bg-red-50" : "")}
                columns={[{ title: "Line", dataIndex: "row", width: 56 }, { title: "Reg. No.", dataIndex: "regNo", width: 100 }, { title: "Naam", dataIndex: "name" },
                  { title: "Pita/Pati", dataIndex: "father" }, { title: "Gaon", dataIndex: "village" }, { title: "Join", dataIndex: "dateJoin", width: 100 },
                  { title: "Kist", dataIndex: "kist", width: 70 }, { title: "Fee", render: (_, r) => (r.joinFee ? `${r.joinFeePaid || 0}/${r.joinFee}` : "—"), width: 80 },
                  { title: "Status", dataIndex: "status", width: 120, render: (v, r) => (v === "closed" ? <Tag color="purple">closed {r.closingDate}</Tag> : v === "blocked" ? <Tag color="red">blocked</Tag> : <Tag color="green">active</Tag>) }]} />) },
            ...(s.payments ? [{ key: "p", label: `Payments (${s.payments})`, children: (
              <Table size="small" rowKey="row" dataSource={check.payments} pagination={{ pageSize: 20 }}
                columns={[{ title: "Line", dataIndex: "row", width: 56 }, { title: "Bharne wala", dataIndex: "payer" }, { title: "Closing", dataIndex: "closing" },
                  { title: "Rakam", dataIndex: "amount", render: inr }, { title: "Tareekh", dataIndex: "date" }, { title: "Tarika", dataIndex: "method" }]} />) }] : []),
          ]} />
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-white py-3">
            {errCount ? <Checkbox checked={skipBad} onChange={(e) => setSkipBad(e.target.checked)}>Galat lines chhod do, baaki import karo</Checkbox> : <span />}
            <Popconfirm title="Import shuru karein?" description="Members, dues, closing aur payment ban jayenge. Baad mein 'Undo' se hata sakte hain." onConfirm={start}>
              <Button type="primary" size="large" loading={busy} disabled={errCount > 0 && !skipBad} icon={<FiUploadCloud />}>Import shuru karein</Button>
            </Popconfirm>
          </div>
        </div>
      )}

      {stage === "run" && (
        !job ? <div className="py-10 text-center text-gray-500">Load ho raha hai…</div> : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Tag color={STATUS[job.status]?.[0]}>{STATUS[job.status]?.[1] || job.status}</Tag>
              <span className="text-sm text-gray-500">{job.source_project}</span>
              {rep.undone ? <Tag color="default">Undo ho chuka</Tag> : null}
            </div>
            <div className="space-y-3">
              {(job.steps || []).map((st) => (
                <div key={st.key} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{st.label}</span>
                    <span className="text-gray-500">{st.done}/{st.total}{st.note ? ` · ${st.note}` : ""}</span>
                  </div>
                  <Progress percent={st.total ? Math.round((st.done / st.total) * 100) : st.status === "done" ? 100 : 0} size="small"
                    strokeColor={STEP_COLOR[st.status]} status={st.status === "run" ? "active" : undefined} showInfo={false} />
                </div>
              ))}
            </div>
            {job.status !== "running" && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat title="Members bane" value={rep.created || 0} />
                  <Stat title="Closings" value={rep.closings || 0} />
                  <Stat title="Payments" value={`${rep.payments || 0} · ${inr(rep.paymentAmount)}`} />
                  <Stat title="Nahi hue" value={rep.failures?.length || 0} danger={!!rep.failures?.length} />
                </div>
                {job.error ? <Alert type="error" showIcon message={job.error} /> : null}
                {rep.failures?.length ? (
                  <Table size="small" rowKey={(r, i) => i} dataSource={rep.failures} pagination={{ pageSize: 10 }} title={() => <b>Ye lines nahi hui</b>}
                    columns={[{ title: "Sheet", dataIndex: "sheet", width: 90 }, { title: "Line", dataIndex: "rows", width: 90 }, { title: "Wajah", dataIndex: "error" }]} />
                ) : null}
                <Space wrap>
                  {job.hasLogins ? (
                    <>
                      <Button type="primary" icon={<FiKey />} href={`/api${base}/${job.id}/logins`}>Naye login passwords (CSV)</Button>
                      <Popconfirm title="Passwords file delete karein?" description="Download karne ke baad delete kar dein." onConfirm={() => act("dropLogins")}>
                        <Button icon={<FiTrash2 />}>Passwords delete</Button>
                      </Popconfirm>
                    </>
                  ) : null}
                  {!rep.undone && rep.created ? (
                    <Popconfirm title={`${rep.created} imported members hatayein?`} okButtonProps={{ danger: true }}
                      description="Unke dues, closing, payment aur login bhi hat jayenge. Import ke baad unpar alag payment hua ho to nahi hatega." onConfirm={() => act("undo")}>
                      <Button danger icon={<FiRotateCcw />}>Undo import</Button>
                    </Popconfirm>
                  ) : null}
                </Space>
              </>
            )}
            {job.log?.length ? (
              <div className="max-h-48 overflow-auto rounded-lg bg-gray-900 p-3 font-mono text-xs text-gray-100">
                {job.log.map((l, i) => <div key={i} className={l.level === "error" ? "text-red-300" : ""}>{new Date(l.t).toLocaleTimeString("en-IN")} · {l.msg}</div>)}
              </div>
            ) : null}
          </div>
        )
      )}
    </Drawer>
  );
}

function Stat({ title, value, danger }) {
  return (
    <div className={`rounded-xl border p-3 ${danger ? "border-red-200 bg-red-50" : "bg-gray-50"}`}>
      <Statistic title={<span className="text-xs">{title}</span>} value={value} valueStyle={{ fontSize: 18, color: danger ? "#dc2626" : undefined }} />
    </div>
  );
}

function PastImports({ rows, onOpen }) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="mb-2 font-semibold">Pichhle import</div>
      <Table size="small" rowKey="id" dataSource={rows} pagination={false} locale={{ emptyText: <Empty description="Koi nahi" /> }}
        onRow={(r) => ({ onClick: () => onOpen(r), className: "cursor-pointer" })}
        columns={[
          { title: "Kab", dataIndex: "started_at", render: (v) => new Date(v).toLocaleString("en-IN") },
          { title: "File", dataIndex: "file" },
          { title: "Members", dataIndex: "created", render: (v, r) => (r.undone ? <span className="line-through">{v || 0}</span> : v || 0) },
          { title: "Payments", dataIndex: "payments", render: (v) => v || 0 },
          { title: "", dataIndex: "status", render: (v, r) => (r.undone ? <Tag>Undo</Tag> : <Tag color={STATUS[v]?.[0]}>{STATUS[v]?.[1] || v}</Tag>) },
        ]} />
    </div>
  );
}
