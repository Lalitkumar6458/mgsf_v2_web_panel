"use client";
// Settings → Mobile App: what every agent / member phone sees.
//   • maintenance — the app shows "रखरखाव चल रहा है" until switched off
//   • update      — latest / minimum version (below minimum the app is blocked until updated)
//   • payment     — "भुगतान करें" in the app: UPI (QR made for the amount), bank account, own QR, steps
//   • support     — phone / WhatsApp / e-mail / office hours on the app's settings screen
// Stored on admins.extra.app (lib/appSettings.js).
import { useEffect, useState } from "react";
import { App, Button, Input, Switch, Upload, Alert, Segmented, Select, InputNumber, Tag } from "antd";
import { FiSave, FiUpload, FiTrash2, FiSmartphone } from "react-icons/fi";
import { api } from "@/lib/client/api";
import { isUpiId } from "@/lib/appSettings";
import { displayCount, describeCountDisplay } from "@/lib/memberCountDisplay";
import { useFeature } from "@/lib/AuthProvider";

function Row({ title, desc, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className="sm:w-60 shrink-0">
        <div className="text-sm font-medium text-gray-900">{title}</div>
        {desc && <div className="text-xs text-gray-500">{desc}</div>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

const Section = ({ title, desc, children, right }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3 mb-2">
      <div>
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500">{title}</div>
        {desc && <div className="text-xs text-gray-400 mt-0.5">{desc}</div>}
      </div>
      {right}
    </div>
    {children}
  </div>
);

/** Settings → Mobile App → "Yojna ki kul sadasya sankhya": who sees it and which number. */
function MemberCountSection({ s, set, shaped }) {
  const [programs, setPrograms] = useState([]);
  useEffect(() => { api.get("/programs").then((r) => setPrograms(r.programs || [])).catch(() => {}); }, []);
  const mc = s.memberCount;
  const anyOn = mc.agents || mc.members;
  const custom = (pid) => mc.custom?.[pid] || { mode: "actual" };
  const setCustom = (pid, patch) => set("memberCount.custom", { ...(mc.custom || {}), [pid]: { ...custom(pid), ...patch } });
  // preview of the number the app will show (fixed: from now on; + new members after saving)
  const shown = (p) => {
    if (!shaped || mc.source === "actual") return p.totalMembers;
    if (mc.source === "yojna") return displayCount(p.totalMembers, p.extra?.countDisplay);
    const c = custom(p.id);
    return displayCount(p.totalMembers, c.mode === "fixed" ? { ...c, baseActual: c.baseActual ?? p.totalMembers } : c);
  };
  return (
    <Section title="Yojna ki kul sadasya sankhya (app mein)" desc="App ke home par 'योजना के कुल सदस्य' dikhe ya nahi, aur kaun si ginti">
      <Row title="Agent app mein dikhayein"><Switch checked={mc.agents} onChange={(v) => set("memberCount.agents", v)} /></Row>
      <Row title="Member app mein dikhayein" desc="Member ko sirf uski apni yojna ki ginti"><Switch checked={mc.members} onChange={(v) => set("memberCount.members", v)} /></Row>
      {anyOn ? (
        <>
          <Row title="Kaun si ginti" desc={shaped ? null : "Percent / fixed ke liye feature-control mein 'Member count display' chalu karein — abhi asli ginti dikhegi"}>
            <Segmented value={mc.source} onChange={(v) => set("memberCount.source", v)} disabled={!shaped}
              options={[{ value: "yojna", label: "Yojna jaisa (panel wala)" }, { value: "actual", label: "Asli ginti" }, { value: "custom", label: "App ke liye alag (% / fixed)" }]} />
          </Row>
          <div className="mt-2 space-y-2">
            {programs.map((p) => {
              const c = custom(p.id);
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                  <div className="min-w-[140px] flex-1">
                    <div className="text-sm font-medium text-gray-900">{p.hiname || p.name}</div>
                    <div className="text-xs text-gray-500">Asli: {p.totalMembers?.toLocaleString("en-IN")}
                      {mc.source === "yojna" && shaped ? ` · yojna setting: ${describeCountDisplay(p.extra?.countDisplay)}` : ""}</div>
                  </div>
                  {mc.source === "custom" && shaped ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select size="small" className="w-36" value={c.mode} onChange={(mode) => setCustom(p.id, mode === "percent" ? { mode, percent: c.percent || 100 } : mode === "fixed" ? { mode, fixed: c.fixed ?? p.totalMembers, baseActual: undefined } : { mode })}
                        options={[{ value: "actual", label: "Asli ginti" }, { value: "percent", label: "Percent (%)" }, { value: "fixed", label: "Fixed ginti se" }]} />
                      {c.mode === "percent" ? <InputNumber size="small" min={1} max={1000} value={c.percent} onChange={(v) => setCustom(p.id, { percent: v || 100 })} addonAfter="%" className="!w-32" /> : null}
                      {c.mode === "fixed" ? <InputNumber size="small" min={0} value={c.fixed} onChange={(v) => setCustom(p.id, { fixed: v ?? 0, baseActual: undefined })} className="!w-32" /> : null}
                    </div>
                  ) : null}
                  <Tag color="blue" className="text-sm">App mein: {shown(p)?.toLocaleString("en-IN")}</Tag>
                </div>
              );
            })}
          </div>
          {mc.source === "custom" ? <div className="mt-2 text-xs text-gray-500">Fixed: jo ginti likhi wahi abhi dikhegi, uske baad jitne naye member judenge utne badhenge. Percent: asli ginti ka utna %.</div> : null}
        </>
      ) : <div className="text-xs text-gray-400">Dono band — app mein kul sadasya sankhya nahi dikhegi.</div>}
    </Section>
  );
}

export default function MobileAppSettings() {
  const { message } = App.useApp();
  const feature = useFeature();
  const payOn = feature("appPayment");
  const memberLoginOn = feature("memberLogin");
  const agentLoginOn = feature("agentLogin");
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/trust/app-settings").then((r) => { setS(r.settings); setSaved(r.settings); }).catch((e) => message.error(e.message));
  }, [message]);

  if (!s) return <div className="p-6 text-gray-500">Load ho raha hai…</div>;

  const set = (path, value) => setS((old) => {
    const next = structuredClone(old);
    const keys = path.split(".");
    let o = next;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = value;
    return next;
  });
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const upiBad = s.payment.upiId && !isUpiId(s.payment.upiId);

  const save = async () => {
    if (upiBad) return message.error("UPI ID sahi nahi hai (jaise trust@sbi)");
    setSaving(true);
    try {
      const r = await api.put("/trust/app-settings", s);
      setS(r.settings);
      setSaved(r.settings);
      message.success("Mobile app settings save ho gayi — sab phones par agli baar khulne par lagu");
    } catch (e) {
      message.error(e.message || "Save nahi hua");
    } finally {
      setSaving(false);
    }
  };

  const uploadQr = async ({ file }) => {
    try {
      const { url } = await api.upload(file, "trust");
      set("payment.qrImage", url);
    } catch (e) { message.error(e.message || "Upload nahi hua"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FiSmartphone className="text-xl text-gray-500" />
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Mobile App (agent + member)</h3>
            <p className="text-xs text-gray-500">Ye settings har phone par app khulte hi (aur har 3 minute mein) check hoti hain.</p>
          </div>
        </div>
        <Button type="primary" icon={<FiSave />} loading={saving} disabled={!dirty} onClick={save}>Save</Button>
      </div>

      <Section title="App login" desc="Kaun app mein login kar sakta hai — ye developer ke feature control se tay hota hai">
        <Row title="Member login (सदस्य)" desc={memberLoginOn ? "App mein 'सदस्य' login dikhta hai" : "Band — app mein 'सदस्य' login dikhega hi nahi"}>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${memberLoginOn ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{memberLoginOn ? "Chalu" : "Band"}</span>
        </Row>
        <Row title="Agent login (एजेंट)" desc={agentLoginOn ? "App mein 'एजेंट' login dikhta hai" : "Band — app mein 'एजेंट' login dikhega hi nahi"}>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${agentLoginOn ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{agentLoginOn ? "Chalu" : "Band"}</span>
        </Row>
      </Section>

      <MemberCountSection s={s} set={set} shaped={feature("countDisplay")} />

      <Section
        title="Maintenance (रखरखाव)"
        desc="Chalu karte hi sab phones par app band — sirf 'रखरखाव चल रहा है' dikhega"
        right={<Switch checked={s.maintenance.on} onChange={(v) => set("maintenance.on", v)} />}
      >
        {s.maintenance.on && <Alert type="warning" showIcon className="mb-2" message="Maintenance chalu hai — save karte hi koi agent / member app use nahi kar payega." />}
        <Row title="Sandesh" desc="Khaali = default sandesh">
          <Input.TextArea rows={2} maxLength={400} value={s.maintenance.message} onChange={(e) => set("maintenance.message", e.target.value)} placeholder="ऐप पर अभी काम चल रहा है। थोड़ी देर बाद दोबारा खोलें।" />
        </Row>
        <Row title="Kab tak" desc="Jaise: आज शाम 6 बजे तक">
          <Input maxLength={60} value={s.maintenance.until} onChange={(e) => set("maintenance.until", e.target.value)} />
        </Row>
      </Section>

      <Section title="App update" desc="Naya version Play Store / link par daalne ke baad yahan version likhein">
        <Row title="Naya (latest) version" desc="Isse purane app par 'नया अपडेट उपलब्ध' aayega (band kar sakte hain)">
          <Input maxLength={20} value={s.update.latestVersion} onChange={(e) => set("update.latestVersion", e.target.value.trim())} placeholder="2.1.0" className="max-w-40" />
        </Row>
        <Row title="Kam se kam (minimum) version" desc="Isse purane app band — update karna zaroori">
          <Input maxLength={20} value={s.update.minVersion} onChange={(e) => set("update.minVersion", e.target.value.trim())} placeholder="2.0.0" className="max-w-40" />
        </Row>
        <Row title="Update link" desc="Play Store ya APK ka https link">
          <Input maxLength={400} value={s.update.url} onChange={(e) => set("update.url", e.target.value.trim())} placeholder="https://play.google.com/store/apps/details?id=com.mgsf.mgsf_app" />
        </Row>
        <Row title="Update sandesh">
          <Input.TextArea rows={2} maxLength={400} value={s.update.message} onChange={(e) => set("update.message", e.target.value)} />
        </Row>
      </Section>

      {!payOn ? (
        <Section title="App se bhugtan (भुगतान करें)">
          <Alert type="info" showIcon message="App se bhugtan is panel mein chalu nahi hai" description="Ye feature developer ke feature control se band hai — app mein 'भुगतान करें' button nahi dikhega. Chalu karwane ke liye support se sampark karein." />
        </Section>
      ) : (
      <Section title="App se bhugtan (भुगतान करें)" desc="Member / agent app mein UPI QR, bank khata dikhega. Paisa aane par rasid office hi banata hai.">
        <Row title="Members ke liye">
          <Switch checked={s.payment.members} onChange={(v) => set("payment.members", v)} />
        </Row>
        <Row title="Agents ke liye" desc="Agent vasooli ki rakam trust ko bhej sake">
          <Switch checked={s.payment.agents} onChange={(v) => set("payment.agents", v)} />
        </Row>
        <Row title="UPI ID" desc="Khaali = Settings → Rasid design wali UPI ID">
          <Input status={upiBad ? "error" : ""} maxLength={120} value={s.payment.upiId} onChange={(e) => set("payment.upiId", e.target.value.trim())} placeholder="trust@sbi" />
        </Row>
        <Row title="Paane wale ka naam" desc="UPI app mein dikhta hai">
          <Input maxLength={80} value={s.payment.payeeName} onChange={(e) => set("payment.payeeName", e.target.value)} />
        </Row>
        <Row title="Bank khata" desc="NEFT / IMPS ke liye (khata number khaali = bank nahi dikhega)">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input placeholder="Khatadhaarak ka naam" value={s.payment.bank.accountName} onChange={(e) => set("payment.bank.accountName", e.target.value)} />
            <Input placeholder="Khata number" value={s.payment.bank.accountNumber} onChange={(e) => set("payment.bank.accountNumber", e.target.value)} />
            <Input placeholder="IFSC" value={s.payment.bank.ifsc} onChange={(e) => set("payment.bank.ifsc", e.target.value.toUpperCase())} />
            <Input placeholder="Bank ka naam" value={s.payment.bank.bankName} onChange={(e) => set("payment.bank.bankName", e.target.value)} />
            <Input placeholder="Shakha (branch)" value={s.payment.bank.branch} onChange={(e) => set("payment.bank.branch", e.target.value)} className="sm:col-span-2" />
          </div>
        </Row>
        <Row title="Apna QR code (photo)" desc="Bank / PhonePe se mila QR (rakam member khud daalega)">
          <div className="flex items-center gap-3">
            {s.payment.qrImage ? <img src={s.payment.qrImage} alt="QR" className="w-20 h-20 object-contain border rounded" /> : null}
            <Upload accept="image/png,image/jpeg" showUploadList={false} customRequest={uploadQr}>
              <Button icon={<FiUpload />}>{s.payment.qrImage ? "Badlo" : "Upload"}</Button>
            </Upload>
            {s.payment.qrImage ? <Button danger icon={<FiTrash2 />} onClick={() => set("payment.qrImage", "")} /> : null}
          </div>
        </Row>
        <Row title="Bhugtan ki suchna (WhatsApp no.)" desc="Member yahan UTR / screenshot bhejega">
          <Input maxLength={20} value={s.payment.confirmWhatsapp} onChange={(e) => set("payment.confirmWhatsapp", e.target.value)} placeholder="9876543210" className="max-w-52" />
        </Row>
        <Row title="Kaise karein (steps)" desc="Ek line = ek step (khaali = default steps)">
          <Input.TextArea rows={4} value={(s.payment.steps || []).join("\n")} onChange={(e) => set("payment.steps", e.target.value.split("\n"))} />
        </Row>
        <Row title="Note">
          <Input.TextArea rows={2} maxLength={400} value={s.payment.note} onChange={(e) => set("payment.note", e.target.value)} placeholder="ऐप से भुगतान अपने-आप जमा नहीं होता। पैसा ट्रस्ट के खाते में आने के बाद कार्यालय रसीद बनाता है।" />
        </Row>
      </Section>
      )}

      <Section title="Sampark (app ki settings mein)" desc="Khaali = Settings → Organization wale phone / e-mail">
        <Row title="Phone"><Input maxLength={60} value={s.support.phone} onChange={(e) => set("support.phone", e.target.value)} /></Row>
        <Row title="WhatsApp"><Input maxLength={20} value={s.support.whatsapp} onChange={(e) => set("support.whatsapp", e.target.value)} /></Row>
        <Row title="E-mail"><Input maxLength={120} value={s.support.email} onChange={(e) => set("support.email", e.target.value)} /></Row>
        <Row title="Office ka samay"><Input maxLength={120} value={s.support.officeHours} onChange={(e) => set("support.officeHours", e.target.value)} placeholder="सुबह 10 से शाम 5 (रविवार बंद)" /></Row>
        <Row title="Website"><Input maxLength={200} value={s.support.website} onChange={(e) => set("support.website", e.target.value)} /></Row>
        <Row title="Trust ke baare mein" desc="App ki settings mein dikhega">
          <Input.TextArea rows={3} maxLength={1500} value={s.aboutText} onChange={(e) => set("aboutText", e.target.value)} />
        </Row>
      </Section>
    </div>
  );
}
