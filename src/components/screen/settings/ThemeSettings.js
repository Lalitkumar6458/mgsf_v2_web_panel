"use client";
// Settings → Theme: one colour theme for the whole panel (sidebar, top bar, buttons, tabs, links).
// Clicking a theme previews it live on the real app; "Save" stores it for every user of the trust.
import { useMemo, useState } from "react";
import { App, Button, ColorPicker, Segmented, Tag, Tooltip } from "antd";
import { FiCheck, FiRotateCcw, FiSave } from "react-icons/fi";
import { useAppTheme } from "@/lib/theme/ThemeProvider";
import { PRESETS, SIDEBAR_STYLES, buildTheme, normalizeTheme } from "@/lib/theme/themes";
import { useCan } from "@/lib/AuthProvider";

const same = (a, b) => JSON.stringify(normalizeTheme(a)) === JSON.stringify(normalizeTheme(b));

/** A tiny picture of the app in a theme: sidebar, top bar, a card with a button. */
function MiniApp({ vars, height = 92 }) {
  const v = (k) => vars[k];
  return (
    <div style={{ display: "flex", height, borderRadius: 10, overflow: "hidden", border: "1px solid #e5e7eb", background: v("--page-bg") }}>
      <div style={{ width: "30%", background: `linear-gradient(180deg, ${v("--sb-bg1")}, ${v("--sb-bg2")})`, padding: 7, display: "flex", flexDirection: "column", gap: 5, borderRight: `1px solid ${v("--sb-border")}` }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 3 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: v("--brand") }} />
          <span style={{ height: 4, flex: 1, borderRadius: 2, background: v("--sb-logo-text"), opacity: 0.8 }} />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", gap: 4, alignItems: "center", padding: "3px 3px", borderRadius: 4, background: i === 1 ? v("--sb-active-bg") : "transparent" }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: i === 1 ? v("--sb-active-icon-bg") : v("--sb-icon-bg") }} />
            <span style={{ height: 3, flex: 1, borderRadius: 2, background: i === 1 ? v("--sb-active-text") : v("--sb-muted"), opacity: i === 1 ? 0.9 : 0.5 }} />
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ height: 16, background: v("--tb-bg"), borderBottom: `1px solid ${v("--tb-border")}`, display: "flex", alignItems: "center", gap: 4, padding: "0 6px" }}>
          <span style={{ height: 3, width: 26, borderRadius: 2, background: "#334155", opacity: 0.6 }} />
          <span style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: 99, background: v("--brand") }} />
        </div>
        <div style={{ flex: 1, padding: 6 }}>
          <div style={{ background: "#fff", borderRadius: 5, height: "100%", border: `1px solid ${v("--tb-border")}`, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ height: 3, width: "60%", borderRadius: 2, background: "#94a3b8" }} />
            <span style={{ height: 3, width: "40%", borderRadius: 2, background: "#cbd5e1" }} />
            <span style={{ marginTop: "auto", alignSelf: "flex-start", height: 9, width: 30, borderRadius: 3, background: v("--brand") }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ThemeSettings() {
  const { message } = App.useApp();
  const can = useCan();
  const canEdit = can("settings", "edit");
  const { saved, active, preview, setPreview, save } = useAppTheme();
  const [saving, setSaving] = useState(false);

  const current = preview || saved; // what is chosen right now (raw: preset / primary / sidebar)
  const dirty = !!preview && !same(preview, saved);
  const presetVars = useMemo(() => Object.fromEntries(PRESETS.map((p) => [p.key, buildTheme({ preset: p.key }).vars])), []);
  const customVars = useMemo(() => buildTheme({ ...current, preset: "custom", primary: active.primary }).vars, [current, active.primary]);

  const choose = (t) => setPreview(normalizeTheme(t));
  const pickPreset = (key) => choose({ preset: key });
  const pickColor = (hex) => choose({ preset: "custom", primary: hex, sidebar: current.sidebar || active.sidebar });
  const pickSidebar = (s) => choose({ ...current, sidebar: s });

  const onSave = async () => {
    setSaving(true);
    try {
      await save(current);
      message.success("Theme save ho gaya — sabhi users ko yahi rang dikhega");
    } catch (e) {
      message.error(e.message || "Save nahi hua");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[240px]">
          <h3 className="text-lg font-semibold text-gray-900 m-0">App theme</h3>
          <p className="text-sm text-gray-500 mt-1 mb-0">
            Poore panel ka rang: sidebar, top bar, buttons, tabs aur links. Theme par click karte hi poora app
            usi rang mein dikhega; <b>Save</b> karne par trust ke sabhi users ko yahi dikhega.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <Tag color="orange" className="!m-0">Save nahi hua</Tag>}
          {preview && <Button icon={<FiRotateCcw />} onClick={() => setPreview(null)}>Wapas</Button>}
          <Button type="primary" icon={<FiSave />} loading={saving} disabled={!canEdit || !dirty} onClick={onSave}>Save theme</Button>
        </div>
      </div>
      {!canEdit && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Aap theme dekh sakte hain; badalne ke liye Settings → Edit permission chahiye.</div>}

      <section>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Ready-made themes</div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
          {PRESETS.map((p) => {
            const on = current.preset === p.key && !current.primary && !current.sidebar;
            return (
              <button
                key={p.key}
                type="button"
                disabled={!canEdit}
                onClick={() => pickPreset(p.key)}
                className="text-left rounded-xl p-2.5 bg-white transition disabled:cursor-not-allowed"
                style={{
                  border: on ? `2px solid ${p.primary}` : "1px solid #e5e7eb",
                  boxShadow: on ? `0 6px 18px ${presetVars[p.key]["--brand-shadow"]}` : "0 1px 2px rgba(15,23,42,0.04)",
                  padding: on ? 9 : 10,
                }}
              >
                <MiniApp vars={presetVars[p.key]} />
                <div className="flex items-center gap-2 mt-2.5">
                  <span style={{ width: 14, height: 14, borderRadius: 99, background: p.primary, flexShrink: 0 }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-xs text-gray-500 truncate">{p.hi} · {SIDEBAR_STYLES.find((s) => s.value === p.sidebar)?.label} sidebar</div>
                  </div>
                  {on && <FiCheck style={{ color: p.primary }} size={18} />}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Apna rang chunein</div>
        <div className="flex flex-wrap gap-6 items-start">
          <div className="w-[260px] max-w-full"><MiniApp vars={customVars} height={120} /></div>
          <div className="space-y-4 flex-1 min-w-[240px]">
            <div>
              <div className="text-sm font-medium text-gray-700 mb-1.5">Brand colour</div>
              <ColorPicker
                disabled={!canEdit}
                value={active.primary}
                showText
                disabledAlpha
                onChangeComplete={(c) => pickColor(c.toHexString())}
                presets={[{ label: "Suggested", colors: ["#2563eb", "#4f46e5", "#7c3aed", "#db2777", "#e11d48", "#dc2626", "#ea580c", "#d97706", "#a16207", "#65a30d", "#16a34a", "#059669", "#0d9488", "#0891b2", "#0369a1", "#475569"] }]}
              />
              <div className="text-xs text-gray-500 mt-1.5">Bahut halka rang chuna to buttons par text padhne layak rakhne ke liye use thoda gehra kar diya jaata hai.</div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-700 mb-1.5">Sidebar style</div>
              <Segmented
                disabled={!canEdit}
                value={active.sidebar}
                onChange={pickSidebar}
                options={SIDEBAR_STYLES.map((s) => ({ label: s.label, value: s.value }))}
              />
            </div>
          </div>
        </div>
      </section>

      <p className="text-xs text-gray-400 m-0">
        Tip: ye theme sirf admin panel ka hai; PDF rasid aur certificate apne alag design mein hi bante hain.
        <Tooltip title="Theme har browser mein yaad rehta hai, isliye page reload par rang nahi badalta."><span className="underline decoration-dotted ml-1 cursor-help">Kaise yaad rehta hai?</span></Tooltip>
      </p>
    </div>
  );
}
