"use client";
// Settings → Rasid: how receipts (रसीद) look — layout, colours, titles, UPI QR, verify QR,
// stamp / signature, notes — with a live PDF preview (lib/receiptSettings.js, lib/pdf/receipts.js).
import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Switch, Segmented, Spin, Upload, Tooltip } from "antd";
import { FiSave, FiRefreshCw, FiUpload, FiTrash2, FiFileText, FiCheck } from "react-icons/fi";
import { api } from "@/lib/client/api";
import { isUpiId } from "@/lib/receiptSettings";
import { useFeature } from "@/lib/AuthProvider";

const LAYOUT_ICON = {
  a5: <svg viewBox="0 0 40 52" className="w-9 h-11"><rect x="6" y="2" width="28" height="40" rx="2" fill="currentColor" opacity=".15" stroke="currentColor" /></svg>,
  a4: <svg viewBox="0 0 40 52" className="w-9 h-11"><rect x="3" y="1" width="34" height="48" rx="2" fill="currentColor" opacity=".15" stroke="currentColor" /></svg>,
  a4x2: <svg viewBox="0 0 52 40" className="w-11 h-9"><rect x="1" y="3" width="50" height="34" rx="2" fill="none" stroke="currentColor" /><rect x="3" y="5" width="22" height="30" fill="currentColor" opacity=".15" /><rect x="27" y="5" width="22" height="30" fill="currentColor" opacity=".15" /><line x1="26" y1="4" x2="26" y2="36" stroke="currentColor" strokeDasharray="2 2" /></svg>,
  thermal: <svg viewBox="0 0 40 52" className="w-9 h-11"><rect x="13" y="1" width="14" height="50" rx="1" fill="currentColor" opacity=".15" stroke="currentColor" /></svg>,
};

function Row({ title, desc, children }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900">{title}</div>
        {desc && <div className="text-xs text-gray-500">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

const Section = ({ title, children }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4">
    <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">{title}</div>
    {children}
  </div>
);

export default function ReceiptSettings() {
  const { message } = App.useApp();
  const feature = useFeature();
  const upiOn = feature("upiQr"), verifyOn = feature("verifyQr");
  const [meta, setMeta] = useState(null);
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState({ status: "pending", url: null, loading: false });
  const timer = useRef(null);
  const urlRef = useRef(null);

  useEffect(() => {
    api.get("/trust/receipt-settings").then((r) => { setMeta(r); setS(r.settings); setSaved(r.settings); }).catch((e) => message.error(e.message));
  }, [message]);

  const loadPreview = useCallback(async (settings, status) => {
    setPreview((p) => ({ ...p, loading: true }));
    try {
      const res = await fetch("/api/receipts/preview", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings, status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Preview nahi bana");
      const url = URL.createObjectURL(await res.blob());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPreview((p) => ({ ...p, url, loading: false }));
    } catch (e) {
      message.error(e.message);
      setPreview((p) => ({ ...p, loading: false }));
    }
  }, [message]);

  // refresh the preview a moment after the last change
  useEffect(() => {
    if (!s) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => loadPreview(s, preview.status), 700);
    return () => clearTimeout(timer.current);
  }, [s, preview.status, loadPreview]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  if (!s || !meta) return <div className="py-16 flex justify-center"><Spin /></div>;

  const set = (k, v) => setS((p) => ({ ...p, [k]: v }));
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const upiBad = upiOn && s.showUpiQr && !isUpiId(s.upiId);

  const save = async () => {
    if (upiBad) { message.error("UPI ID sahi nahi hai (jaise trust@sbi)"); return; }
    setSaving(true);
    try {
      const r = await api.put("/trust/receipt-settings", s);
      setS(r.settings); setSaved(r.settings);
      message.success("Rasid design save ho gaya — agli rasid isi se banegi");
    } catch (e) { message.error(e.message); } finally { setSaving(false); }
  };

  const uploadSign = async ({ file }) => {
    try {
      const { url } = await api.upload(file, "receipts");
      set("signImg", url);
    } catch (e) { message.error(e.message || "Upload nahi hua"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <FiFileText className="text-indigo-600" />
        <h3 className="text-lg font-semibold m-0">Rasid (receipt) design</h3>
        <div className="flex-1" />
        <Button disabled={!dirty} onClick={() => setS(saved)}>Wapas</Button>
        <Button type="primary" icon={dirty ? <FiSave /> : <FiCheck />} loading={saving} disabled={!dirty} onClick={save}>{dirty ? "Save" : "Saved"}</Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-4 items-start">
        <div className="space-y-4">
          <Section title="Page ka size">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {meta.layouts.map((l) => (
                <button key={l.key} type="button" onClick={() => set("layout", l.key)}
                  className={`rounded-xl border p-2.5 text-left transition ${s.layout === l.key ? "border-indigo-600 ring-2 ring-indigo-100 text-indigo-700" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                  <div className="flex justify-center mb-1.5">{LAYOUT_ICON[l.key]}</div>
                  <div className="text-xs font-semibold text-gray-900">{l.label}</div>
                  <div className="text-[11px] text-gray-500 leading-snug mt-0.5">{l.desc}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Rang (theme)">
            <div className="flex flex-wrap gap-2">
              {meta.themes.map((t) => (
                <button key={t.key} type="button" onClick={() => set("theme", t.key)}
                  className={`flex items-center gap-2 rounded-full border pl-1.5 pr-3 py-1 text-sm ${s.theme === t.key ? "border-indigo-600 ring-2 ring-indigo-100" : "border-gray-200"}`}>
                  <span className="flex -space-x-1">
                    <span className="w-5 h-5 rounded-full border border-white" style={{ background: t.primary }} />
                    <span className="w-5 h-5 rounded-full border border-white" style={{ background: t.accent }} />
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Shirshak (title)">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-1">Pending (बकाया) rasid</div>
                <Input value={s.pendingTitle} maxLength={40} onChange={(e) => set("pendingTitle", e.target.value)} placeholder={meta.defaults.pendingTitle} />
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-1">Paid (भुगतान) rasid</div>
                <Input value={s.paidTitle} maxLength={40} onChange={(e) => set("paidTitle", e.target.value)} placeholder={meta.defaults.paidTitle} />
              </div>
            </div>
          </Section>

          <Section title="Pending (बकाया) rasid">
            <Row title="Antim tithi (last date)" desc="Print ki tareekh + itne din. 0 = mat dikhao">
              <InputNumber min={0} max={365} value={s.dueDays} onChange={(v) => set("dueDays", v ?? 0)} addonAfter="din" style={{ width: 130 }} />
            </Row>
            {upiOn && <Row title="UPI QR code" desc="Member scan kare to rakam bhari hui aaye — seedha trust ke khate mein">
              <Switch checked={s.showUpiQr} onChange={(v) => set("showUpiQr", v)} />
            </Row>}
            {upiOn && s.showUpiQr && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2">
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-1">UPI ID</div>
                  <Input value={s.upiId} status={upiBad ? "error" : ""} onChange={(e) => set("upiId", e.target.value.trim())} placeholder="trustname@sbi" />
                  {upiBad && <div className="text-xs text-red-600 mt-1">UPI ID jaise: trust@sbi, 9876543210@ybl</div>}
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-1">Khate ka naam</div>
                  <Input value={s.upiName} maxLength={60} onChange={(e) => set("upiName", e.target.value)} placeholder="Trust ka naam" />
                </div>
              </div>
            )}
            <div className="pt-1">
              <div className="text-xs font-semibold text-gray-500 mb-1">Neeche ki line</div>
              <Input.TextArea rows={2} maxLength={200} value={s.pendingNote} onChange={(e) => set("pendingNote", e.target.value)} />
            </div>
          </Section>

          <Section title="Paid (भुगतान) rasid">
            {verifyOn && <Row title="Verify QR code" desc="Scan karke koi bhi jaanch sake ki rasid asli hai">
              <Switch checked={s.showVerifyQr} onChange={(v) => set("showVerifyQr", v)} />
            </Row>}
            <Row title="'भुगतान प्राप्त' watermark" desc="Page par halka sa likha hua">
              <Switch checked={s.showWatermark} onChange={(v) => set("showWatermark", v)} />
            </Row>
            <div className="pt-1">
              <div className="text-xs font-semibold text-gray-500 mb-1">Neeche ki line</div>
              <Input.TextArea rows={2} maxLength={200} value={s.paidNote} onChange={(e) => set("paidNote", e.target.value)} />
            </div>
          </Section>

          <Section title="Dono par">
            <Row title="Rakam shabdon mein" desc="जैसे: एक हज़ार पाँच सौ रुपये मात्र">
              <Switch checked={s.showAmountWords} onChange={(v) => set("showAmountWords", v)} />
            </Row>
            <Row title="Trust ki mohar (stamp)" desc="Settings → Organization mein upload ki hui">
              <Switch checked={s.showStamp} onChange={(v) => set("showStamp", v)} />
            </Row>
            <Row title="Hastakshar (signature) image" desc="Safed background par sign ki photo / scan">
              <div className="flex items-center gap-2">
                {s.signImg && <img src={s.signImg} alt="sign" className="h-9 max-w-[120px] object-contain border rounded bg-white" />}
                <Upload accept="image/png,image/jpeg" showUploadList={false} customRequest={uploadSign}>
                  <Button size="small" icon={<FiUpload />}>{s.signImg ? "Badlo" : "Upload"}</Button>
                </Upload>
                {s.signImg && <Tooltip title="Hatao"><Button size="small" danger icon={<FiTrash2 />} onClick={() => set("signImg", "")} /></Tooltip>}
              </div>
            </Row>
          </Section>
        </div>

        <div className="xl:sticky xl:top-2 space-y-2">
          <div className="flex items-center gap-2">
            <Segmented value={preview.status} onChange={(v) => setPreview((p) => ({ ...p, status: v }))}
              options={[{ value: "pending", label: "Pending rasid" }, { value: "paid", label: "Paid rasid" }]} />
            <div className="flex-1" />
            {preview.loading && <Spin size="small" />}
            <Tooltip title="Preview dobara"><Button size="small" icon={<FiRefreshCw />} onClick={() => loadPreview(s, preview.status)} /></Tooltip>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-100 overflow-hidden" style={{ height: "min(78vh, 900px)" }}>
            {preview.url
              ? <iframe title="Rasid preview" src={`${preview.url}#toolbar=0&view=FitH`} className="w-full h-full border-0" />
              : <div className="h-full flex items-center justify-center"><Spin /></div>}
          </div>
          <div className="text-xs text-gray-500">Preview mein namoona (sample) member hai. Save karne ke baad sabhi nayi rasid isi design se banengi.</div>
        </div>
      </div>
    </div>
  );
}
