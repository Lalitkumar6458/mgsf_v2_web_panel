"use client";
// Settings → Notifications: send a push notification to member / agent phones (Expo push — free,
// no Firebase on the server) + the automatic ones (payment received, new closing).
// A send also lands in the app's "सूचनाएँ" inbox, so a phone without push still sees it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, Select, Switch, Table, Tag, Tooltip } from "antd";
import { FiBell, FiSend, FiRefreshCw, FiSmartphone, FiUsers, FiZap } from "react-icons/fi";
import { api } from "@/lib/client/api";

const TO = [
  { value: "all", label: "Sab (members + agents)" },
  { value: "members", label: "Sirf members" },
  { value: "agents", label: "Sirf agents" },
  { value: "dues", label: "Jinka bakaya hai (raashi apne aap judegi)" },
  { value: "member", label: "Chune hue member" },
];
const TO_LABEL = { all: "Sab", members: "Members", agents: "Agents", dues: "Bakaya wale", member: "Chune hue", agent: "Agent" };

const TEMPLATES = [
  { label: "Bhugtan yaad dilana", to: "dues", title: "बकाया भुगतान की याद 🙏", body: "कृपया अपना बकाया जल्द जमा करें। ऐप में 'भुगतान करें' से UPI द्वारा भी भेज सकते हैं।" },
  { label: "Meeting / sabha", to: "all", title: "समाज की बैठक", body: "दिनांक __ को __ बजे __ में समाज की बैठक है। सभी सदस्य ज़रूर पधारें।" },
  { label: "Shubhkamna", to: "all", title: "हार्दिक शुभकामनाएँ 🌸", body: "ट्रस्ट परिवार की ओर से आप सभी को हार्दिक शुभकामनाएँ।" },
  { label: "App update", to: "all", title: "ऐप का नया अपडेट", body: "ऐप का नया वर्शन आ गया है — Play Store से अपडेट करें।" },
];

const Card = ({ title, desc, icon: Icon, right, children }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="flex items-start gap-2">
        {Icon ? <Icon className="mt-0.5 text-gray-400" /> : null}
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500">{title}</div>
          {desc && <div className="text-xs text-gray-400 mt-0.5">{desc}</div>}
        </div>
      </div>
      {right}
    </div>
    {children}
  </div>
);

const fmt = (d) => { try { return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

export default function AppNotifications() {
  const { message, modal } = App.useApp();
  const [programs, setPrograms] = useState([]);
  const [to, setTo] = useState("all");
  const [programId, setProgramId] = useState("");
  const [picked, setPicked] = useState([]); // [{ value: id, label }]
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [aud, setAud] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState([]);
  const [loadingSent, setLoadingSent] = useState(false);
  const [settings, setSettings] = useState(null);

  const loadSent = useCallback(async () => {
    setLoadingSent(true);
    try { setSent((await api.get("/notifications/sent")).sent || []); } catch {} finally { setLoadingSent(false); }
  }, []);

  useEffect(() => {
    api.get("/programs").then((r) => setPrograms(r.programs || [])).catch(() => {});
    api.get("/trust/app-settings").then((r) => setSettings(r.settings)).catch(() => {});
    loadSent();
  }, [loadSent]);

  // live "kitne phone par jayegi"
  const memberIds = useMemo(() => picked.map((p) => p.value), [picked]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (to === "member" && !memberIds.length) return setAud(null);
      const q = new URLSearchParams({ to, ...(programId ? { programId } : {}), ...(memberIds.length ? { memberIds: memberIds.join(",") } : {}) });
      api.get(`/notifications/audience?${q}`).then(setAud).catch(() => setAud(null));
    }, 300);
    return () => clearTimeout(t);
  }, [to, programId, memberIds]);

  const search = async (q) => {
    const pid = programId || programs[0]?.id;
    if (!pid || q.trim().length < 2) return setOptions([]);
    setSearching(true);
    try {
      const r = await api.get(`/programs/${pid}/members?q=${encodeURIComponent(q.trim())}&pageSize=20&status=accepted`);
      setOptions((r.members || []).map((m) => ({ value: m.id, label: `${m.displayName}${m.registrationNumber ? ` · ${m.registrationNumber}` : ""}${m.village ? ` · ${m.village}` : ""}` })));
    } catch {} finally { setSearching(false); }
  };

  const phones = aud ? (to === "agents" ? 0 : aud.memberPhones) + (["all", "agents"].includes(to) ? aud.agentPhones : 0) : 0;

  const send = () => {
    if (!title.trim()) return message.error("Title likhein");
    if (to === "member" && !memberIds.length) return message.error("Member chunein");
    modal.confirm({
      title: "Notification bhejein?",
      content: aud ? `${TO_LABEL[to]} — ${phones} phone par push jayegi (baaki ko app ki सूचनाएँ list mein dikhegi).` : "Bhejein?",
      okText: "Haan, bhejo",
      cancelText: "Ruko",
      onOk: async () => {
        setSending(true);
        try {
          const r = await api.post("/notifications/send", { title, body, to, programId: programId || undefined, memberIds });
          message.success(`Bhej di — ${r.pushed} phone par pahunchi${r.failed ? `, ${r.failed} par nahi` : ""} · ${r.saved} login ki सूचनाएँ mein`);
          setTitle(""); setBody(""); setPicked([]);
          loadSent();
        } catch (e) {
          message.error(e.message || "Nahi bheji ja saki");
        } finally { setSending(false); }
      },
    });
  };

  const toggleAuto = async (key, v) => {
    if (!settings) return;
    const next = { ...settings, notify: { ...settings.notify, [key]: v } };
    setSettings(next);
    try {
      const r = await api.put("/trust/app-settings", next);
      setSettings(r.settings);
      message.success("Save ho gaya");
    } catch (e) { message.error(e.message || "Save nahi hua"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FiBell className="text-xl text-gray-500" />
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Notifications (app)</h3>
          <p className="text-xs text-gray-500">Member / agent ke phone par push notification — Expo se, free. Har suchna app ki "सूचनाएँ" list mein bhi rehti hai.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <Card title="Nayi suchna bhejein" icon={FiSend}>
            <div className="flex flex-wrap gap-2 mb-3">
              {TEMPLATES.map((t) => (
                <Button key={t.label} size="small" onClick={() => { setTo(t.to); setTitle(t.title); setBody(t.body); }}>{t.label}</Button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-medium text-gray-600 mb-1">Kisko</div>
                <Select className="w-full" value={to} onChange={(v) => { setTo(v); setPicked([]); }} options={TO} />
              </div>
              <div>
                <div className="text-xs font-medium text-gray-600 mb-1">Yojna</div>
                <Select className="w-full" value={programId} onChange={(v) => { setProgramId(v); setPicked([]); setOptions([]); }} disabled={to === "agents"}
                  options={[{ value: "", label: "Sabhi yojna" }, ...programs.map((p) => ({ value: p.id, label: p.name }))]} />
              </div>
            </div>
            {to === "member" ? (
              <div className="mt-3">
                <div className="text-xs font-medium text-gray-600 mb-1">Member (naam / reg. no. likhkar khojein)</div>
                <Select mode="multiple" labelInValue className="w-full" showSearch filterOption={false} value={picked} onChange={setPicked}
                  onSearch={search} loading={searching} options={options} placeholder="जैसे रमेश / R100023"
                  notFoundContent={searching ? "Khoj rahe hain…" : "2+ akshar likhein"} />
              </div>
            ) : null}
            <div className="mt-3">
              <div className="text-xs font-medium text-gray-600 mb-1">Title</div>
              <Input maxLength={120} showCount value={title} onChange={(e) => setTitle(e.target.value)} placeholder="जैसे: समाज की बैठक" />
            </div>
            <div className="mt-3">
              <div className="text-xs font-medium text-gray-600 mb-1">Sandesh</div>
              <Input.TextArea rows={4} maxLength={1000} showCount value={body} onChange={(e) => setBody(e.target.value)} placeholder="पूरा संदेश…" />
              {to === "dues" ? <div className="text-xs text-amber-700 mt-1">Har member ke sandesh ke neeche uska bakaya (₹) apne aap jud jayega.</div> : null}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-gray-600 flex items-center gap-2">
                <FiUsers />
                {aud ? (
                  <span>
                    {to !== "agents" ? <><b>{aud.members}</b> member{" "}</> : null}
                    {["all", "agents"].includes(to) ? <><b>{aud.agents}</b> agent{" "}</> : null}
                    · <FiSmartphone className="inline -mt-0.5" /> <b>{phones}</b> phone par push
                  </span>
                ) : <span className="text-gray-400">—</span>}
              </div>
              <Button type="primary" icon={<FiSend />} loading={sending} onClick={send}>Bhejein</Button>
            </div>
          </Card>

          <Card title="Bheji gayi suchnayein" icon={FiBell} right={<Button size="small" icon={<FiRefreshCw />} onClick={loadSent} loading={loadingSent} />}>
            <Table size="small" rowKey="batch" dataSource={sent} pagination={{ pageSize: 8, hideOnSinglePage: true }} loading={loadingSent}
              locale={{ emptyText: "Abhi tak koi suchna nahi bheji" }}
              columns={[
                { title: "Suchna", dataIndex: "title", render: (t, r) => <div><div className="font-medium">{t}</div>{r.body ? <div className="text-xs text-gray-500 line-clamp-2">{r.body}</div> : null}</div> },
                { title: "Kisko", dataIndex: "to", width: 110, render: (v) => <Tag>{TO_LABEL[v] || v || "—"}</Tag> },
                { title: "Kab", dataIndex: "sentAt", width: 130, render: fmt },
                { title: "Padhi", width: 90, render: (_, r) => <Tooltip title={`${r.read} ne app mein khol kar dekhi, kul ${r.logins} login`}>{r.read}/{r.logins}</Tooltip> },
              ]} />
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Card title="Phone par aise dikhegi" icon={FiSmartphone}>
            <div className="rounded-2xl bg-gray-900 p-3">
              <div className="rounded-xl bg-white/95 p-3 shadow">
                <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1"><span className="inline-block w-4 h-4 rounded bg-[var(--brand)]" /> Trust app · abhi</div>
                <div className="font-semibold text-sm text-gray-900 break-words">{title || "Title"}</div>
                <div className="text-xs text-gray-700 whitespace-pre-line break-words line-clamp-4">{(body || "Sandesh") + (to === "dues" ? "\nआपका बकाया: ₹1,200" : "")}</div>
              </div>
            </div>
          </Card>

          <Card title="Apne aap jaane wali" icon={FiZap} desc="Kaam hote hi phone par suchna — inhe band bhi kar sakte hain">
            {[
              { key: "payment", t: "Bhugtan jama hone par", d: "Member ko: ₹ kitna jama hua, rasid app mein" },
              { key: "closing", t: "Nayi closing par (member)", d: "Har member ko uski raashi aur antim tithi" },
              { key: "agentClosing", t: "Nayi closing par (agent)", d: "Agent ko: uske kitne members se kitni vasooli" },
            ].map((x) => (
              <div key={x.key} className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
                <div>
                  <div className="text-sm font-medium text-gray-900">{x.t}</div>
                  <div className="text-xs text-gray-500">{x.d}</div>
                </div>
                <Switch checked={settings ? settings.notify?.[x.key] !== false : true} disabled={!settings} onChange={(v) => toggleAuto(x.key, v)} />
              </div>
            ))}
          </Card>

          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-900 leading-5">
            Push tabhi pahunchti hai jab member / agent ne naya app install karke <b>login</b> kiya ho aur notification ki <b>anumati (Allow)</b> di ho.
            Jinke phone par push nahi pahunchi, unhe bhi app kholne par "सूचनाएँ" mein dikhegi.
          </div>
        </div>
      </div>
    </div>
  );
}
