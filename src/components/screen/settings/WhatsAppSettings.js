"use client";
// Settings → WhatsApp: the trust's own Gupshup app, the 3 automatic messages (template ID + what goes
// in each {{n}}), callback URL for status + inbox, bulk "baki" reminder and the sent-messages log.
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, Switch, Select, Tag, Table, Popconfirm, Segmented, Tooltip, Checkbox, Collapse } from "antd";
import { FiCopy, FiSend, FiSave, FiRefreshCw, FiFileText, FiCheck, FiAlertCircle, FiLink, FiPlus } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "@/lib/client/api";
import { WA_EVENTS, WA_VARIABLES, WA_MEDIA, slotCount, fill, preview, sampleVars } from "@/lib/whatsappSettings";

const STATUS = {
  submitted: ["blue", "Bheja"], enqueued: ["blue", "Queue mein"], queued: ["default", "Queue"], sent: ["cyan", "Sent ✓"],
  delivered: ["geekblue", "Delivered ✓✓"], read: ["green", "Padh liya ✓✓"], failed: ["red", "Fail"],
};
const EVENT_LABEL = { join: "Join", pending: "Baki", paid: "Jama", test: "Test", reply: "Reply" };
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

function Card({ title, icon, extra, children, tone }) {
  return (
    <section className={`rounded-2xl border bg-white p-4 sm:p-5 ${tone || "border-gray-200"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-gray-900">{icon}{title}</div>
        {extra}
      </div>
      {children}
    </section>
  );
}

/** WhatsApp-style preview bubble. */
function Bubble({ text, media }) {
  return (
    <div className="rounded-xl bg-[#e5ddd5] p-3">
      <div className="ml-auto max-w-[95%] rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 text-[13px] leading-relaxed text-gray-900 shadow-sm">
        {media ? (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-white/70 px-2 py-1.5 text-xs text-gray-700">
            <FiFileText className="text-red-500" /> {media}
          </div>
        ) : null}
        <div className="whitespace-pre-wrap break-words">{text || <span className="text-gray-400">Template ka text yahan dikhega</span>}</div>
        <div className="mt-1 text-right text-[10px] text-gray-500">10:30 ✓✓</div>
      </div>
    </div>
  );
}

function EventCard({ meta, ev, onChange, onTest, testing }) {
  const slots = slotCount(ev.body);
  const n = slots || ev.params.length;
  const params = Array.from({ length: n }, (_, i) => ev.params[i] ?? "");
  const setParam = (i, v) => { const p = [...params]; p[i] = v; onChange({ params: p }); };
  const sample = useMemo(sampleVars, []);
  const filled = params.map((p) => fill(p, sample) || "-");
  const [phone, setPhone] = useState("");

  return (
    <Card
      tone={ev.on ? "border-emerald-200" : "border-gray-200"}
      icon={<span className={`flex h-8 w-8 items-center justify-center rounded-full text-white ${ev.on ? "bg-emerald-500" : "bg-gray-300"}`}><FaWhatsapp /></span>}
      title={<div><div>{meta.label}</div><div className="text-xs font-normal text-gray-500">{meta.desc}</div></div>}
      extra={<Switch checked={ev.on} onChange={(v) => onChange({ on: v })} checkedChildren="Chalu" unCheckedChildren="Band" />}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-600">Template ID (Gupshup se copy)</span>
              <Input value={ev.templateId} onChange={(e) => onChange({ templateId: e.target.value.trim() })} placeholder="jaise c49ee21d-4d39-452d-a6c1-…" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-600">PDF (template ke header mein)</span>
              <Select className="w-full" value={ev.media} onChange={(v) => onChange({ media: v })}
                options={Object.entries(WA_MEDIA).map(([value, label]) => ({ value, label }))} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Template ka text (Gupshup mein jo approve hua — {"{{1}} {{2}}"} ke saath paste karein)</span>
            <Input.TextArea rows={3} value={ev.body} onChange={(e) => onChange({ body: e.target.value })}
              placeholder={"नमस्ते {{1}} जी, आपका रजि. नंबर {{2}} है। {{3}} में आपका स्वागत है।"} />
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600">Har {"{{n}}"} mein kya jaayega {slots ? <Tag className="ml-1" color="green">{slots} jagah mili</Tag> : null}</span>
              {!slots ? <Button size="small" type="link" icon={<FiPlus />} onClick={() => onChange({ params: [...params, ""] })}>Jagah jodein</Button> : null}
            </div>
            {!n ? <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">Template text paste karein — usme {"{{1}}"} {"{{2}}"} apne aap gin liye jayenge.</div> : null}
            <div className="space-y-2">
              {params.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 rounded-md bg-emerald-50 py-1 text-center font-mono text-xs font-bold text-emerald-700">{`{{${i + 1}}}`}</span>
                  <Input value={p} onChange={(e) => setParam(i, e.target.value)} placeholder="Variable chunein ya likhein" />
                  <Select className="w-44 shrink-0" placeholder="+ Variable" value={null} showSearch optionFilterProp="label" popupMatchSelectWidth={260}
                    onChange={(k) => setParam(i, `${p}{${k}}`)}
                    options={WA_VARIABLES.map((v) => ({ value: v.key, label: `${v.label}` }))} />
                </div>
              ))}
            </div>
          </div>

          {meta.key === "pending" ? (
            <Checkbox checked={ev.onClosing} onChange={(e) => onChange({ onClosing: e.target.checked })}>
              Nayi closing darj hote hi baki walon ko apne aap bhejein
            </Checkbox>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-600">Preview (sample data)</div>
          <Bubble text={ev.body ? preview(ev.body, filled) : filled.join(" · ")} media={ev.media !== "none" ? WA_MEDIA[ev.media] : null} />
          <div className="flex gap-2">
            <Input size="small" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Apna mobile" maxLength={14} />
            <Button size="small" icon={<FiSend />} loading={testing} disabled={!ev.templateId || phone.replace(/\D/g, "").length < 10}
              onClick={() => onTest(meta.key, phone)}>Test</Button>
          </div>
          <div className="text-[11px] text-gray-400">Test se pehle Save karein. Test mein sample data aur Gupshup ki sample PDF jaati hai.</div>
        </div>
      </div>
    </Card>
  );
}

function SentLog() {
  const [event, setEvent] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.get("/whatsapp/log", { event, status, page })); } catch { /* shown empty */ } finally { setLoading(false); }
  }, [event, status, page]);
  useEffect(() => { load(); }, [load]);
  const c = data?.counts || {};
  const stat = (label, v, cls) => (
    <div className="rounded-xl bg-gray-50 px-3 py-2"><div className={`text-xl font-bold ${cls}`}>{v ?? "–"}</div><div className="text-[11px] text-gray-500">{label}</div></div>
  );
  return (
    <Card icon={<FiCheck className="text-emerald-600" />} title="Bheje gaye message" extra={<Button size="small" icon={<FiRefreshCw />} onClick={load} loading={loading}>Refresh</Button>}>
      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {stat("Kul", c.total, "text-gray-900")}{stat("Raste mein", c.waiting, "text-blue-600")}{stat("Sent", c.sent, "text-cyan-600")}
        {stat("Delivered", c.delivered, "text-indigo-600")}{stat("Padh liya", c.read, "text-emerald-600")}{stat("Fail", c.failed, "text-red-600")}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Segmented size="small" value={event} onChange={(v) => { setEvent(v); setPage(1); }}
          options={[{ value: "", label: "Sab" }, { value: "join", label: "Join" }, { value: "pending", label: "Baki" }, { value: "paid", label: "Jama" }, { value: "reply", label: "Reply" }, { value: "test", label: "Test" }]} />
        <Select size="small" className="w-40" value={status} onChange={(v) => { setStatus(v); setPage(1); }}
          options={[{ value: "", label: "Har status" }, ...Object.entries(STATUS).map(([value, [, label]]) => ({ value, label }))]} />
      </div>
      <Table size="small" rowKey="id" loading={loading} dataSource={data?.messages || []} scroll={{ x: 760 }} tableLayout="fixed"
        pagination={{ current: page, pageSize: data?.pageSize || 50, total: c.total || 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
        columns={[
          { title: "Kisko", width: 190, render: (_, r) => <div><div className="font-medium">{r.name || `+${r.phone}`}</div><div className="text-xs text-gray-500">{[r.regNo, r.name ? `+${r.phone}` : ""].filter(Boolean).join(" · ")}</div></div> },
          { title: "Message", dataIndex: "event", width: 80, render: (e) => <Tag>{EVENT_LABEL[e] || e}</Tag> },
          { title: "Text", dataIndex: "body", responsive: ["lg"], render: (b, r) => <div className="truncate text-xs text-gray-600" title={b}>{r.mediaUrl ? "📄 " : ""}{b}</div> },
          { title: "Status", dataIndex: "status", width: 150, render: (s, r) => {
            const [color, label] = STATUS[s] || ["default", s];
            return r.error ? <Tooltip title={r.error}><Tag color={color} icon={<FiAlertCircle className="mr-1 inline" />}>{label}</Tag></Tooltip> : <Tag color={color}>{label}</Tag>;
          } },
          { title: "Kab", dataIndex: "at", width: 120, render: (d) => <span className="whitespace-nowrap text-xs">{when(d)}</span> },
        ]} />
    </Card>
  );
}

function BulkPending({ disabled }) {
  const { message } = App.useApp();
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState("");
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/programs").then((r) => setPrograms(r.programs || [])).catch(() => {}); }, []);
  useEffect(() => { setCount(null); api.get("/whatsapp/send", { programId }).then((r) => setCount(r.members)).catch(() => {}); }, [programId]);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post("/whatsapp/send", { event: "pending", programId: programId || undefined });
      message.success(`${r.queued} sadasyon ko bheja ja raha hai — status neeche "Bheje gaye message" mein dekhein`);
    } catch (e) { message.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Card icon={<FiSend className="text-amber-600" />} title="Baki payment reminder — sabko ek saath">
      <div className="flex flex-wrap items-center gap-3">
        <Select className="w-56" value={programId} onChange={setProgramId}
          options={[{ value: "", label: "Sabhi yojna" }, ...programs.map((p) => ({ value: p.id, label: p.name }))]} />
        <div className="text-sm text-gray-600"><b className="text-gray-900">{count ?? "…"}</b> sadasyon ka bakaya hai</div>
        <Popconfirm title={`${count} sadasyon ko WhatsApp bhejein?`} description="Har message ka Gupshup / Meta charge lagta hai." okText="Haan, bhejo" cancelText="Nahi" onConfirm={send} disabled={!count || disabled}>
          <Button type="primary" icon={<FaWhatsapp />} loading={busy} disabled={!count || disabled} style={!count || disabled ? undefined : { background: "#16a34a" }}>Baki rasid ke saath bhejein</Button>
        </Popconfirm>
      </div>
      {disabled ? <div className="mt-2 text-xs text-amber-700">Pehle upar Gupshup jodein, &quot;Baki payment&quot; ka template bharein aur Save karein.</div> : null}
    </Card>
  );
}

export default function WhatsAppSettings() {
  const { message } = App.useApp();
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(null);
  const [cb, setCb] = useState(null); // { callbackUrl, callbackHeader: { name, value }, callbackUrlWithKey }
  const [showKey, setShowKey] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState("");

  const load = useCallback(async () => {
    const r = await api.get("/whatsapp/settings");
    setS(r.settings); setSaved(r.settings); setCb(r);
  }, []);
  useEffect(() => { load().catch((e) => message.error(e.message)); }, [load, message]);

  if (!s) return <div className="py-10 text-center text-gray-400">Load ho raha hai…</div>;
  const dirty = JSON.stringify(s) !== JSON.stringify(saved) || !!apiKey;
  const setEvent = (k, patch) => setS((x) => ({ ...x, events: { ...x.events, [k]: { ...x.events[k], ...patch } } }));
  const connected = s.apiKeySet && s.source && s.appName;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put("/whatsapp/settings", { ...s, apiKey });
      setS(r.settings); setSaved(r.settings); setCb(r); setApiKey("");
      message.success("WhatsApp settings save ho gayi");
    } catch (e) { message.error(e.message); } finally { setSaving(false); }
  };
  const test = async (event, phone) => {
    setTesting(event);
    try {
      await api.post("/whatsapp/test", { event, phone });
      message.success("Test message Gupshup ko bhej diya — phone par 1 minute mein aana chahiye");
    } catch (e) { message.error(e.message, 8); } finally { setTesting(""); }
  };
  const copy = (text, what) => { navigator.clipboard?.writeText(text); message.success(`${what} copy ho gaya`); };
  const rotate = async () => {
    setRotating(true);
    try {
      const r = await api.put("/whatsapp/settings", { ...saved, apiKey: "", rotateSecret: true });
      setCb(r); setShowKey(true);
      message.success("Nayi key ban gayi — Gupshup mein header ki value badal dein, purani key ab kaam nahi karegi", 6);
    } catch (e) { message.error(e.message); } finally { setRotating(false); }
  };
  const hdr = cb?.callbackHeader || { name: "x-webhook-key", value: "" };

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#25D366] text-2xl text-white"><FaWhatsapp /></div>
          <div>
            <h3 className="text-lg font-semibold text-gray-800">WhatsApp (Gupshup)</h3>
            <p className="text-xs text-gray-500">Join par certificate, baki rasid aur jama rasid — trust ke apne WhatsApp number se apne aap.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {s.enabled && connected ? <Tag color="green">Chalu</Tag> : <Tag>Band</Tag>}
          <Switch checked={s.enabled} onChange={(v) => setS((x) => ({ ...x, enabled: v }))} checkedChildren="Chalu" unCheckedChildren="Band" />
        </div>
      </div>

      <Card icon={<FiLink className="text-blue-600" />} title="1. Gupshup jodein">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">API key</span>
            <Input.Password value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} placeholder={s.apiKeySet ? `Saved ${s.apiKeyHint} — badalna ho to nayi daalein` : "Gupshup → Account → API key"} autoComplete="new-password" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">WhatsApp business number</span>
            <Input value={s.source} onChange={(e) => setS((x) => ({ ...x, source: e.target.value.replace(/[^\d+]/g, "") }))} placeholder="91XXXXXXXXXX" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Gupshup app name</span>
            <Input value={s.appName} onChange={(e) => setS((x) => ({ ...x, appName: e.target.value.trim() }))} placeholder="jaise GsmmfTrust" />
          </label>
        </div>
        <div className="mt-4 space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
          <div className="text-xs font-semibold text-blue-900">Gupshup → App → Webhooks / Callback URL mein bas ye URL daalein</div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-blue-800">Callback URL</span>
            <div className="flex gap-2">
              <Input readOnly value={cb?.callbackUrl || ""} className="font-mono text-xs" />
              <Button icon={<FiCopy />} onClick={() => copy(cb?.callbackUrl, "URL")}>Copy</Button>
            </div>
          </label>
          <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-blue-800">Header naam (optional)</span>
              <div className="flex gap-2">
                <Input readOnly value={hdr.name} className="font-mono text-xs" />
                <Button icon={<FiCopy />} onClick={() => copy(hdr.name, "Header naam")} />
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-blue-800">Header value / key (optional)</span>
              <div className="flex gap-2">
                <Input readOnly value={showKey ? hdr.value : "•".repeat(32)} className="font-mono text-xs" />
                <Button onClick={() => setShowKey((v) => !v)}>{showKey ? "Chhupao" : "Dikhao"}</Button>
                <Button icon={<FiCopy />} onClick={() => copy(hdr.value, "Key")} />
                <Popconfirm title="Nayi key banayein?" description="Purani key turant band — Gupshup mein nayi value daalni hogi." okText="Haan" cancelText="Nahi" onConfirm={rotate}>
                  <Tooltip title="Nayi key banao"><Button icon={<FiRefreshCw />} loading={rotating} /></Tooltip>
                </Popconfirm>
              </div>
            </label>
          </div>
          <div className="text-[11px] text-blue-800">
            URL sab trust ke liye ek hi hai. Trust ki pehchaan header ki key se hoti hai, ya key na ho to Gupshup ke <b>app name</b> se — isliye upar &quot;Gupshup app name&quot; bilkul wahi likhein jo Gupshup mein hai. Isse har message ka status (delivered / padh liya / fail) aur member ke jawab (WhatsApp inbox) panel mein aate hain.
            <b>Dhyan:</b> Gupshup sirf internet par khula <b>https</b> URL leta hai — <code>localhost</code> wala URL kabhi accept nahi hoga. Server par deploy karke yahan jo URL dikhe wahi daalein.
          </div>
        </div>
        <Collapse ghost size="small" className="mt-2" items={[{
          key: "how", label: <span className="text-xs font-semibold text-gray-600">Gupshup par setup kaise karein? (ek baar)</span>,
          children: (
            <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-600">
              <li>gupshup.io par account banayein → <b>WhatsApp → Create App</b> (app ka naam = upar &quot;app name&quot;).</li>
              <li>Trust ka naya number jodein (Facebook Business verify + number). Jo number WhatsApp app mein chal raha ho, wo nahi lagega.</li>
              <li><b>Templates</b> mein 3 template banayein (category <b>Utility</b>, header <b>Document</b>), text mein {"{{1}} {{2}}"} rakhein. Approve hone par Template ID copy karke yahan daalein.</li>
              <li>Account → <b>API key</b> copy karke yahan daalein. App → <b>Webhooks / Callback URL</b> mein upar wala URL daalein (https wala, server ka).</li>
              <li>Wallet mein balance rakhein (har message ka chhota sa charge lagta hai).</li>
            </ol>
          ),
        }]} />
      </Card>

      <div className="text-sm font-semibold text-gray-700">2. Teen message — template aur variable</div>
      {WA_EVENTS.map((meta) => (
        <EventCard key={meta.key} meta={meta} ev={s.events[meta.key]} onChange={(p) => setEvent(meta.key, p)} onTest={test} testing={testing === meta.key} />
      ))}

      <BulkPending disabled={!saved?.enabled || !connected || !saved?.events.pending.templateId} />
      <SentLog />

      <div className="sticky bottom-3 z-10 flex justify-end">
        <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
          {dirty ? <span className="text-xs text-amber-700">Badlav save nahi hue</span> : <span className="text-xs text-gray-400">Sab save hai</span>}
          <Button disabled={!dirty} onClick={() => { setS(saved); setApiKey(""); }}>Wapas</Button>
          <Button type="primary" icon={<FiSave />} loading={saving} disabled={!dirty} onClick={save}>Save</Button>
        </div>
      </div>
    </div>
  );
}
