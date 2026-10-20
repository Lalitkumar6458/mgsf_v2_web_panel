"use client";
// Secret developer screen (same CONTROL_KEY as /feature-control): move a trust from a Firebase project into
// this panel — members, closings, dues, payments, join fees, agents, commission, logins and every photo /
// document — with live progress, a dry run first, and a check of the money afterwards.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { App, Alert, Button, Checkbox, Collapse, Empty, Input, Modal, Progress, Radio, Spin, Table, Tag, Tooltip, Upload } from "antd";
import {
  FiArrowLeft, FiCheckCircle, FiCircle, FiDatabase, FiDownload, FiKey, FiLoader, FiLock, FiPlay, FiRefreshCw, FiSearch,
  FiSlash, FiTrash2, FiUploadCloud, FiXCircle, FiAlertTriangle, FiFileText, FiRotateCcw,
} from "react-icons/fi";

async function call(method, path, body) {
  const res = await fetch(`/api/control${path}`, {
    method, credentials: "include", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.status = res.status; throw e; }
  return data;
}
const fmt = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const SOURCES = [
  { value: "mgsf", title: "Purana MGSF panel", sub: "Firestore: users/{uid}/programs/… (mgsf_web_panel)", hint: "payment_pending → dues, transactions, joinFeesTransactions" },
  { value: "trustNew", title: "Naya trust project", sub: "Firestore: trusts/{trustId}/… (new-trust-project)", hint: "ledger + rasid → dues / transactions, commission + payout" },
];
const STATUS = { running: ["processing", "Chal raha"], done: ["success", "Poora"], failed: ["error", "Fail"], cancelled: ["default", "Roka"], queued: ["default", "Line mein"] };
const MONEY_LABEL = {
  receiptsClosing: "Rasid se closing jama", ledgerPaid: "Ledger mein jama", joinFees: "Join fee jama", commission: "Commission",
  collectedPerDues: "Dues mein jama", collectedPerTransactions: "Transactions ka jod", duesPaid: "Paid dues", duesOpen: "Baki dues",
};
const COUNT_LABEL = { programs: "Yojna", agents: "Agents", closingGroups: "Closing group", members: "Members", closings: "Closings", dues: "Dues", transactions: "Transactions", joinFeePayments: "Join fee", commissions: "Commission", payouts: "Payouts", logins: "Logins", files: "Files" };

function KeyScreen({ onIn }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr("");
    try { await call("POST", "/session", { key }); onIn(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white"><FiLock /></div>
        <h1 className="m-0 text-lg font-bold">Data Migration</h1>
        <p className="mb-3 text-sm text-gray-500">Control key daaliye (feature-control wali)</p>
        <Input.Password size="large" autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder="••••••••••••" />
        {err ? <div className="mt-2 text-sm text-red-600">{err}</div> : null}
        <Button className="mt-3" type="primary" size="large" block htmlType="submit" loading={busy} disabled={!key}>Kholein</Button>
      </form>
    </div>
  );
}

function StepRow({ s }) {
  const icon = { done: <FiCheckCircle className="text-emerald-600" />, run: <FiLoader className="animate-spin text-blue-600" />, fail: <FiXCircle className="text-red-600" />,
    skip: <FiSlash className="text-gray-300" />, wait: <FiCircle className="text-gray-300" /> }[s.status] || <FiCircle />;
  const pct = s.total ? Math.min(100, Math.round((s.done / s.total) * 100)) : s.status === "done" ? 100 : 0;
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 text-lg">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${s.status === "skip" ? "text-gray-400" : "text-gray-900"}`}>{s.label}</span>
          {s.total ? <span className="text-xs text-gray-400">{s.done}/{s.total}</span> : null}
        </div>
        {s.status === "run" || (s.status === "done" && s.total) ? <Progress percent={pct} size="small" showInfo={false} status={s.status === "run" ? "active" : "success"} /> : null}
        {s.note ? <div className={`truncate text-xs ${s.status === "fail" ? "text-red-600" : "text-gray-500"}`}>{s.note}</div> : null}
      </div>
    </div>
  );
}

function JobView({ id, onChanged }) {
  const { message, modal } = App.useApp();
  const [job, setJob] = useState(null);
  const logRef = useRef(null);
  const [revert, setRevert] = useState(null); // { info, text, busy }
  const load = useCallback(async () => {
    try { const r = await call("GET", `/migrations/${id}`); setJob(r.job); return r.job; } catch (e) { message.error(e.message); return null; }
  }, [id, message]);
  useEffect(() => {
    let stop = false, t;
    const tick = async () => { const j = await load(); if (!stop && j?.status === "running") t = setTimeout(tick, 1500); else if (!stop) onChanged?.(); };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, [load, onChanged]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [job?.log?.length]);
  if (!job) return <div className="py-16 text-center"><Spin /></div>;
  const rep = job.report || {};
  const counts = rep.counts || {};
  const v = rep.verify;
  const cancel = () => modal.confirm({ title: "Migration rokein?", content: "Commit se pehle roka to database mein kuch nahi likha jaayega.", okText: "Rokein", okButtonProps: { danger: true },
    onOk: async () => { await call("POST", `/migrations/${id}`, { action: "cancel" }); message.info("Rok rahe hain…"); } });
  const askRevert = async () => {
    try { const info = await call("POST", `/migrations/${id}`, { action: "revertInfo" }); setRevert({ info, text: "", busy: false }); }
    catch (e) { message.error(e.message); }
  };
  const doRevert = async () => {
    setRevert((r) => ({ ...r, busy: true }));
    try {
      const r = await call("POST", `/migrations/${id}`, { action: "revert", confirm: revert.text });
      message.success(`Hata diya: ${r.removed.members} members, ${r.removed.transactions} transactions, ${r.removed.logins} logins`);
      setRevert(null); load(); onChanged?.();
    } catch (e) { message.error(e.message); setRevert((r) => ({ ...r, busy: false })); }
  };
  const dropLogins = async () => { await call("POST", `/migrations/${id}`, { action: "dropLogins" }); message.success("Passwords file delete ho gayi"); load(); };
  const warnText = () => {
    const blob = new Blob([(rep.warnings || []).join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `warnings-${job.source_trust_id}.txt`; a.click();
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag color={STATUS[job.status]?.[0]}>{STATUS[job.status]?.[1] || job.status}</Tag>
        <span className="font-semibold">{rep.trustName || job.source_trust_name}</span>
        <span className="text-xs text-gray-500">{job.kind === "mgsf" ? "Purana MGSF" : "Naya trust"} · {job.source_project} · {job.source_trust_id}{job.dry_run ? " · dry run" : job.mode === "replace" ? " · dobara (replace)" : ""}</span>
        <span className="flex-1" />
        {job.running ? <Button danger size="small" icon={<FiSlash />} onClick={cancel}>Rokein</Button> : null}
        {job.status === "done" && !job.dry_run && !rep.reverted ? (
          <Tooltip title="Galti se migrate ho gaya? Ye trust aur uska poora data panel se hata dein">
            <Button danger size="small" icon={<FiRotateCcw />} onClick={askRevert}>Wapas lein (revert)</Button>
          </Tooltip>
        ) : null}
      </div>
      {rep.reverted ? <Alert type="warning" showIcon icon={<FiRotateCcw />} message="Ye migration wapas le liya gaya (revert)"
        description={`${fmt(rep.revertedAt)} · ${rep.revertedCounts?.members ?? 0} members, ${rep.revertedCounts?.transactions ?? 0} transactions, ${rep.revertedCounts?.logins ?? 0} logins hataye. Firebase ka data waisa hi hai — chahein to dobara migrate karein.`} /> : null}
      <Modal open={!!revert} title={<span className="text-red-600">Migration wapas lein — trust hatayein?</span>} onCancel={() => setRevert(null)}
        okText="Haan, poora hatao" okButtonProps={{ danger: true, loading: revert?.busy, disabled: !revert?.text?.trim() }} onOk={doRevert} destroyOnClose>
        {revert ? (
          <div className="space-y-3 text-sm">
            <p><b>{revert.info.name}</b> ({revert.info.email}) aur iska saara data panel se hat jaayega — ek hi baar mein, wapas nahi aayega:</p>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[["Yojna", revert.info.programs], ["Members", revert.info.members], ["Transactions", revert.info.transactions], ["Logins", revert.info.logins]].map(([l, v]) => (
                <div key={l} className="rounded-lg border bg-gray-50 p-2"><div className="text-[11px] text-gray-500">{l}</div><div className="text-lg font-bold">{Number(v).toLocaleString("en-IN")}</div></div>
              ))}
            </div>
            {revert.info.newMembers || revert.info.newTransactions ? (
              <Alert type="error" showIcon message={`Migration ke baad panel mein ${revert.info.newMembers} naye members aur ${revert.info.newTransactions} naye payment daale gaye hain`} description="Ye bhi hat jaayenge. Pakka ho tabhi aage badhein." />
            ) : null}
            {revert.info.replaced ? <Alert type="warning" showIcon message="Ye “pehle wala hata kar dobara” run tha — usse pehle wala data wapas nahi aayega." /> : null}
            <div>Pakka karne ke liye admin e-mail likhein: <code>{revert.info.email || revert.info.adminId}</code></div>
            <Input value={revert.text} onChange={(e) => setRevert((r) => ({ ...r, text: e.target.value }))} placeholder={revert.info.email || revert.info.adminId} onPressEnter={doRevert} />
            <div className="text-xs text-gray-500">Firebase mein kuch nahi badalta. Copy ki hui photos (local storage) bhi hat jaati hain.</div>
          </div>
        ) : null}
      </Modal>
      {job.error ? <Alert type={job.status === "cancelled" ? "warning" : "error"} showIcon message={job.error} /> : null}
      {job.status === "done" && job.dry_run ? <Alert type="info" showIcon message="Dry run poora — database mein kuch nahi likha." description="Neeche ginti aur chetavaniyan dekh lein. Sab theek lage to upar se “Asli migration” chalayein." /> : null}
      {job.status === "done" && !job.dry_run && !rep.reverted ? <Alert type={v?.ok ? "success" : "warning"} showIcon message={v?.ok ? "Migration poora — paisa ka hisaab mil gaya ✓" : "Migration poora, par jaanch mein kuch farq hai"} description={`Admin login: ${rep.adminEmail || "—"} · panel mein is trust se login karke dekhein`} /> : null}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-2">{(job.steps || []).map((s) => <StepRow key={s.key} s={s} />)}</div>
        <div ref={logRef} className="h-64 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-[12px] leading-5 text-slate-200">
          {(job.log || []).map((l, i) => <div key={i} className={l.level === "error" ? "text-red-300" : l.level === "warn" ? "text-amber-300" : ""}><span className="text-slate-500">{new Date(l.t).toLocaleTimeString("en-IN")}</span> {l.msg}</div>)}
          {job.running ? <div className="animate-pulse text-slate-500">…</div> : null}
        </div>
      </div>

      {Object.keys(counts).length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {Object.entries(COUNT_LABEL).filter(([k]) => counts[k] !== undefined).map(([k, label]) => (
            <div key={k} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
              <div className="text-[11px] text-gray-500">{label}</div>
              <div className="text-lg font-bold tabular-nums">{Number(counts[k]).toLocaleString("en-IN")}</div>
              {v?.rows?.[k] !== undefined && v.rows[k] !== counts[k] ? <div className="text-[11px] text-amber-600">DB: {v.rows[k]}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {rep.money ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
          <div className="mb-1 font-semibold">Paisa</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-700">
            {Object.entries(rep.money).map(([k, val]) => <span key={k}>{MONEY_LABEL[k] || k}: <b>{["duesPaid", "duesOpen"].includes(k) ? Number(val).toLocaleString("en-IN") : inr(val)}</b></span>)}
          </div>
          {rep.reconcile && (rep.reconcile.migrationTransactions || rep.reconcile.duesMadeForTransactions) ? (
            <div className="mt-2 text-xs text-amber-700">Milaan: {rep.reconcile.migrationTransactions} migration entries ({inr(rep.reconcile.migrationAmount)}), {rep.reconcile.duesMadeForTransactions} naye due transactions ke liye — “MIG-…” Payment history mein dikhenge.</div>
          ) : null}
        </div>
      ) : null}

      {v ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-2 font-semibold">Import ke baad jaanch</div>
          {v.checks.map((c) => (
            <div key={c.key} className="flex items-start gap-2 py-1 text-sm">
              {c.info ? <FiAlertTriangle className="mt-0.5 text-blue-500" /> : c.ok ? <FiCheckCircle className="mt-0.5 text-emerald-600" /> : <FiXCircle className="mt-0.5 text-red-600" />}
              <div><b>{c.label}</b><div className="text-xs text-gray-500">{c.detail}</div></div>
            </div>
          ))}
        </div>
      ) : null}

      {job.hasLogins ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <FiKey className="text-amber-700" />
          <span className="flex-1">Naye passwords (admin / agent) ki file — sirf yahin milegi. Download karke surakshit dein, phir delete karein.</span>
          <a href={`/api/control/migrations/${id}/logins`}><Button icon={<FiDownload />}>Passwords CSV</Button></a>
          <Button danger icon={<FiTrash2 />} onClick={dropLogins}>Delete</Button>
        </div>
      ) : null}

      <Collapse size="small" items={[
        ...(rep.warningCount ? [{ key: "w", label: <span>Chetavaniyan ({rep.warningCount}){rep.skipped && Object.keys(rep.skipped).length ? ` · chhode: ${Object.entries(rep.skipped).map(([k, n]) => `${k} ${n}`).join(", ")}` : ""}</span>,
          extra: <Button size="small" icon={<FiFileText />} onClick={(e) => { e.stopPropagation(); warnText(); }}>txt</Button>,
          children: <div className="max-h-72 overflow-auto text-xs leading-5">{(rep.warnings || []).map((w, i) => <div key={i}>• {w}</div>)}</div> }] : []),
        ...(rep.skippedLogins?.length ? [{ key: "l", label: `Login nahi bane (${rep.skippedLogins.length})`,
          children: <Table size="small" rowKey={(r, i) => `${r.loginId}-${i}`} pagination={{ pageSize: 10 }} dataSource={rep.skippedLogins} columns={[{ title: "Role", dataIndex: "role" }, { title: "Login", dataIndex: "loginId" }, { title: "Naam", dataIndex: "name" }, { title: "Kyon", dataIndex: "reason" }]} /> }] : []),
        ...(rep.files?.failed ? [{ key: "f", label: `Files jo copy nahi hui (${rep.files.failed}) — purana link rakha`,
          children: <div className="max-h-72 overflow-auto text-xs leading-5">{(rep.files.failedList || []).map((f, i) => <div key={i} className="truncate">• {f.where?.table} {f.where?.id} {f.where?.column}: {f.error}</div>)}</div> }] : []),
      ]} />
    </div>
  );
}

export default function DataMigrationPage() {
  const { message, modal } = App.useApp();
  const [state, setState] = useState("checking");
  const [kind, setKind] = useState("mgsf");
  const [via, setVia] = useState("key"); // key | backup
  const [keyText, setKeyText] = useState("");
  const [keyName, setKeyName] = useState("");
  const [conn, setConn] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(null);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState({ adminEmail: "", adminPassword: "", copyFiles: true, replace: false, confirm: "" });
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState(null);

  const loadJobs = useCallback(async () => { try { setJobs((await call("GET", "/migrations")).jobs); } catch { /* */ } }, []);
  useEffect(() => {
    call("GET", "/session").then((r) => { if (r.loggedIn) { setState("in"); loadJobs(); } else setState("key"); }).catch((e) => setState(e.status === 404 ? "missing" : "key"));
  }, [loadJobs]);

  const readFile = (file) => {
    const r = new FileReader();
    r.onload = () => { setKeyText(String(r.result || "")); setKeyName(file.name); };
    r.readAsText(file);
    return false;
  };
  const doConnect = async () => {
    setBusy(true); setConn(null); setPick(null);
    try {
      const r = await call("POST", "/migrations/connect", via === "backup" ? { kind, backup: keyText } : { kind, serviceAccount: keyText });
      setConn(r);
      message.success(`${r.projectId} se jud gaye · ${r.trusts.length} trust mile`);
    } catch (e) { message.error(e.message, 6); } finally { setBusy(false); }
  };
  const trust = conn?.trusts.find((t) => t.id === pick);
  const start = async (dryRun) => {
    if (!trust) return;
    if (!dryRun && trust.inPanel && !opts.replace) return message.error("Ye trust panel mein pehle se hai — “Pehle wala hata kar dobara” chunein");
    if (!dryRun && opts.replace && opts.confirm.trim() !== trust.id) return message.error(`Pakka karne ke liye trust id “${trust.id}” likhein`);
    const go = async () => {
      try {
        const r = await call("POST", "/migrations", { connectionId: conn.connectionId, trustId: trust.id, trustName: trust.name, mode: opts.replace ? "replace" : "new",
          dryRun, copyFiles: opts.copyFiles, adminEmail: opts.adminEmail.trim(), adminPassword: opts.adminPassword });
        setJobId(r.jobId); loadJobs();
      } catch (e) { message.error(e.message, 6); }
    };
    if (dryRun) return go();
    modal.confirm({
      title: opts.replace ? `“${trust.name}” ka panel wala data hata kar dobara migrate karein?` : `“${trust.name}” ko migrate karein?`,
      content: opts.replace ? "Is trust ka abhi panel mein jo bhi data hai (members, payments…) wo delete hokar Firebase se dobara aayega." : "Firebase ka data padhkar panel mein naya trust banega. Firebase mein kuch nahi badlega.",
      okText: "Haan, shuru karein", okButtonProps: { danger: opts.replace }, onOk: go,
    });
  };
  const shown = useMemo(() => (conn?.trusts || []).filter((t) => !q || `${t.name} ${t.id} ${t.email}`.toLowerCase().includes(q.toLowerCase())), [conn, q]);

  if (state === "checking") return <div className="flex min-h-screen items-center justify-center"><Spin /></div>;
  if (state === "missing") return <div className="flex min-h-screen items-center justify-center text-gray-400">404 · not found</div>;
  if (state === "key") return <KeyScreen onIn={() => { setState("in"); loadJobs(); }} />;

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex items-center gap-3 bg-slate-900 px-4 py-3 text-white">
        <Link href="/feature-control" className="flex items-center gap-1 text-sm text-slate-300 hover:text-white"><FiArrowLeft /> Feature control</Link>
        <span className="text-slate-600">|</span>
        <FiDatabase /><span className="font-semibold">Data Migration</span>
        <span className="text-xs text-slate-400">Firebase → panel (members, payments, commission, photo / document)</span>
      </div>
      <div className="mx-auto grid max-w-7xl gap-4 p-4 xl:grid-cols-[440px_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">1 · Kahan se</div>
            <div className="space-y-2">
              {SOURCES.map((s) => (
                <div key={s.value} role="radio" aria-checked={kind === s.value} tabIndex={0}
                  onClick={() => { setKind(s.value); setConn(null); setPick(null); }}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${kind === s.value ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                  <span className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${kind === s.value ? "border-blue-600 bg-blue-600 shadow-[inset_0_0_0_3px_white]" : "border-gray-300"}`} />
                  <div><div className="font-semibold text-gray-900">{s.title}</div><div className="text-xs text-gray-500">{s.sub}</div><div className="text-[11px] text-gray-400">{s.hint}</div></div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-400">2 · {via === "key" ? "Firebase admin key" : "JSON backup file"}</div>
              <span className="flex-1" />
              <Radio.Group size="small" value={via} onChange={(e) => { setVia(e.target.value); setKeyText(""); setKeyName(""); setConn(null); }} optionType="button"
                options={[{ value: "key", label: "Live (key)" }, { value: "backup", label: "JSON backup" }]} />
            </div>
            <Upload.Dragger accept=".json,application/json" showUploadList={false} beforeUpload={readFile} className="!mb-2">
              <p className="text-2xl text-blue-500"><FiUploadCloud className="mx-auto" /></p>
              <p className="text-sm font-medium">{keyName || (via === "key" ? "service-account .json file yahan chhodein" : "backup .json file yahan chhodein")}</p>
              <p className="text-xs text-gray-400">{via === "key" ? "Firebase console → Project settings → Service accounts → Generate new private key" : "migrate-from-firestore.js --export-json wali file (users[]) ya trusts[] wali"}</p>
            </Upload.Dragger>
            <Input.TextArea rows={2} value={keyText.length > 20000 ? `${keyText.slice(0, 2000)}… (${Math.round(keyText.length / 1024)} KB)` : keyText} readOnly={keyText.length > 20000} onChange={(e) => { setKeyText(e.target.value); setKeyName(""); }} placeholder="…ya JSON yahan paste karein" className="!font-mono !text-xs" />
            <div className="mt-2 flex items-center gap-2">
              <Button type="primary" icon={<FiKey />} loading={busy} disabled={!keyText.trim()} onClick={doConnect}>Connect</Button>
              <span className="text-[11px] text-gray-400">Key kahin save nahi hoti — sirf server memory mein 3 ghante.</span>
            </div>
          </div>

          {conn ? (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <div className="text-xs font-bold uppercase tracking-wide text-gray-400">3 · Trust chunein</div>
                <Tag>{conn.projectId}</Tag>
                <span className="flex-1" />
                {conn.trusts.length > 5 ? <Input size="small" allowClear prefix={<FiSearch />} placeholder="khojein" value={q} onChange={(e) => setQ(e.target.value)} className="!w-36" /> : null}
              </div>
              {!conn.trusts.length ? <Empty description="Is project mein koi trust nahi mila — source sahi chuna?" /> : null}
              <div className="max-h-72 space-y-2 overflow-auto">
                {shown.map((t) => (
                  <div key={t.id} role="radio" aria-checked={pick === t.id} tabIndex={0}
                    onClick={() => { setPick(t.id); setOpts((o) => ({ ...o, adminEmail: t.email || "", replace: false, confirm: "" })); }}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${pick === t.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                    <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${pick === t.id ? "border-blue-600 bg-blue-600 shadow-[inset_0_0_0_3px_white]" : "border-gray-300"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{t.name}</div>
                      <div className="truncate text-xs text-gray-500">{t.id}{t.email ? ` · ${t.email}` : ""}</div>
                    </div>
                    <div className="text-right text-xs text-gray-500"><div>{t.members} members</div><div>{t.programs} yojna</div></div>
                    {t.inPanel ? <Tooltip title="Ye trust panel mein pehle se hai"><Tag color="orange" className="!m-0">panel mein hai</Tag></Tooltip> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {trust ? (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">4 · Kaise</div>
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-gray-600">Admin login e-mail (panel)
                  <Input value={opts.adminEmail} onChange={(e) => setOpts((o) => ({ ...o, adminEmail: e.target.value }))} placeholder="Firebase wala e-mail" /></label>
                <label className="text-xs font-semibold text-gray-600">Admin password (khaali = naya banega, CSV mein milega)
                  <Input.Password value={opts.adminPassword} onChange={(e) => setOpts((o) => ({ ...o, adminPassword: e.target.value }))} placeholder="optional" /></label>
                <Checkbox checked={opts.copyFiles} onChange={(e) => setOpts((o) => ({ ...o, copyFiles: e.target.checked }))}>Photo / document bhi copy karein (Firebase Storage → panel)</Checkbox>
                {trust.inPanel ? (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-2">
                    <Checkbox checked={opts.replace} onChange={(e) => setOpts((o) => ({ ...o, replace: e.target.checked }))}><b>Pehle wala hata kar dobara</b> (panel mein is trust ka sab data delete hoga)</Checkbox>
                    {opts.replace ? <Input className="mt-2" size="small" value={opts.confirm} onChange={(e) => setOpts((o) => ({ ...o, confirm: e.target.value }))} placeholder={`pakka karne ke liye likhein: ${trust.id}`} /> : null}
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button icon={<FiSearch />} onClick={() => start(true)}>Pehle jaanch (dry run)</Button>
                <Button type="primary" icon={<FiPlay />} onClick={() => start(false)} danger={opts.replace}>Asli migration</Button>
              </div>
              <div className="mt-2 text-[11px] text-gray-400">Firebase mein kuch nahi badalta. Database mein sab ek saath likha jaata hai — beech mein ruka to kuch nahi likha jaata.</div>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            {jobId ? <JobView key={jobId} id={jobId} onChanged={loadJobs} /> : <Empty description="Migration chalayein — yahan live dikhega (har step, log, ginti, paisa milaan)" />}
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2"><b>Pichhle migration</b><span className="flex-1" /><Button size="small" icon={<FiRefreshCw />} onClick={loadJobs} /></div>
            <Table size="small" rowKey="id" dataSource={jobs} pagination={{ pageSize: 8, hideOnSinglePage: true }}
              onRow={(r) => ({ onClick: () => setJobId(r.id), style: { cursor: "pointer" } })}
              columns={[
                { title: "Kab", render: (_, r) => fmt(r.started_at), width: 120 },
                { title: "Trust", render: (_, r) => <div><div className="font-medium">{r.source_trust_name}</div><div className="text-[11px] text-gray-400">{r.kind === "mgsf" ? "Purana MGSF" : r.kind === "trustNew" ? "Naya trust" : r.kind} · {r.source_project}</div></div> },
                { title: "Members", render: (_, r) => r.counts?.members ?? "—", width: 80 },
                { title: "", render: (_, r) => <span>{r.dry_run ? <Tag>dry run</Tag> : null}<Tag color={STATUS[r.status]?.[0]}>{STATUS[r.status]?.[1] || r.status}</Tag>{r.reverted ? <Tag color="orange">wapas liya</Tag> : r.verified === true ? <Tag color="green">jaanch ✓</Tag> : null}</span>, width: 200 },
              ]} />
          </div>
        </div>
      </div>
    </div>
  );
}
