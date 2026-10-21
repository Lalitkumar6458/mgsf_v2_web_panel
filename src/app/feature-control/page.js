"use client";
// Secret developer screen: which features each trust's panel may use (lib/features.js).
// Not linked from anywhere. Needs CONTROL_KEY from the server .env — without it the API answers
// 404 and this page shows a plain "not found".
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Input, Modal, Switch, Tag, Tooltip, Empty, Spin, Popconfirm, DatePicker, InputNumber } from "antd";
import dayjs from "dayjs";
import {
  FiLock, FiLogOut, FiSearch, FiCheck, FiRotateCcw, FiPower, FiMonitor, FiZap, FiLogIn, FiUsers, FiAlertTriangle, FiCalendar, FiFileText, FiPhone, FiCopy, FiAward, FiShield, FiMessageCircle, FiSmartphone, FiDatabase, FiTrash2, FiDownload, FiGlobe,
} from "react-icons/fi";
import {
  FEATURE_GROUPS, FEATURE_KEYS, FEATURE_PRESETS, presetFlags, normalizeFeatures, normalizeSupport, DEFAULT_BLOCK_MESSAGE, planState,
} from "@/lib/features";

const GROUP_ICON = { screens: FiMonitor, rasid: FiFileText, certificate: FiAward, members: FiUsers, money: FiShield, connect: FiMessageCircle, app: FiSmartphone, logins: FiLogIn };

async function call(method, path, body) {
  const res = await fetch(`/api/control${path}`, {
    method, credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.status = res.status; throw e; }
  return data;
}

const fmtDate = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const offOf = (f) => FEATURE_KEYS.filter((k) => f.flags[k] === false).length;
const same = (a, b) => a && b && a.active === b.active && (a.message || "") === (b.message || "")
  && (a.expiresAt || null) === (b.expiresAt || null) && a.warnDays === b.warnDays && FEATURE_KEYS.every((k) => a.flags[k] === b.flags[k])
  && JSON.stringify(normalizeSupport(a.support)) === JSON.stringify(normalizeSupport(b.support));

// ─── Key screen ──────────────────────────────────────────────────────────────
function KeyScreen({ onIn }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e?.preventDefault();
    if (!key) return;
    setBusy(true); setErr("");
    try { await call("POST", "/session", { key }); setKey(""); onIn(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="fc-center">
      <form onSubmit={submit} className="fc-keycard">
        <div className="fc-lock"><FiLock /></div>
        <h1>Feature Control</h1>
        <p>Control key daaliye</p>
        <Input.Password size="large" autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder="••••••••••••" autoComplete="off" />
        {err && <div className="fc-err">{err}</div>}
        <Button type="primary" size="large" block htmlType="submit" loading={busy} disabled={!key}>Kholein</Button>
      </form>
    </div>
  );
}

// ─── One switch row ──────────────────────────────────────────────────────────
function FeatureRow({ f, on, changed, onChange }) {
  return (
    <label className={`fc-row ${on ? "" : "is-off"} ${changed ? "is-changed" : ""}`}>
      <div className="fc-row-text">
        <div className="fc-row-title">{f.label} <span className="fc-hi">{f.hi}</span></div>
        <div className="fc-row-desc">{f.desc}</div>
      </div>
      <Switch checked={on} onChange={onChange} />
    </label>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function FeatureControlPage() {
  const { message } = App.useApp();
  const [state, setState] = useState("checking"); // checking | missing | key | in
  const [trusts, setTrusts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { trusts: list } = await call("GET", "/trusts");
      setTrusts(list);
      setSelId((cur) => (list.some((t) => t.id === cur) ? cur : list[0]?.id || null));
    } catch (e) {
      if (e.status === 401) setState("key"); else message.error(e.message);
    } finally { setLoading(false); }
  }, [message]);

  useEffect(() => {
    document.title = "Control";
    call("GET", "/session")
      .then((r) => setState(r.loggedIn ? "in" : "key"))
      .catch(() => setState("missing"));
  }, []);
  useEffect(() => { if (state === "in") load(); }, [state, load]);

  const sel = trusts.find((t) => t.id === selId) || null;
  useEffect(() => { setDraft(sel ? normalizeFeatures(sel.features) : null); }, [selId, trusts]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = sel && draft && !same(draft, normalizeFeatures(sel.features));
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? trusts.filter((t) => `${t.name} ${t.email} ${t.phone || ""}`.toLowerCase().includes(s)) : trusts;
  }, [trusts, q]);

  const pick = (id) => {
    if (id === selId) return;
    if (dirty && !window.confirm("Badlav save nahi hue — chhod dein?")) return;
    setSelId(id);
  };
  const setFlag = (k, v) => setDraft((d) => ({ ...d, flags: { ...d.flags, [k]: v } }));
  const setGroup = (items, v) => setDraft((d) => ({ ...d, flags: { ...d.flags, ...Object.fromEntries(items.map((f) => [f.key, v])) } }));

  const save = async () => {
    setSaving(true);
    try {
      const { features } = await call("PUT", `/trusts/${sel.id}`, { flags: draft.flags, active: draft.active, message: draft.message, expiresAt: draft.expiresAt, warnDays: draft.warnDays, support: draft.support });
      setTrusts((list) => list.map((t) => (t.id === sel.id ? { ...t, features } : t)));
      message.success("Save ho gaya — trust ke panel mein 30 second ke andar lag jayega");
    } catch (e) {
      if (e.status === 401) setState("key");
      message.error(e.message);
    } finally { setSaving(false); }
  };

  // same renew contact on every trust (saves only the contact; each trust keeps its own lock + plan)
  const supportToAll = async () => {
    setSaving(true);
    try {
      const out = [];
      for (const t of trusts) {
        // the open trust: its unsaved edits are saved too (the list refresh would reset them)
        const base = t.id === sel.id ? draft : normalizeFeatures(t.features);
        const { features } = await call("PUT", `/trusts/${t.id}`, { ...base, support: draft.support });
        out.push([t.id, features]);
      }
      const m = new Map(out);
      setTrusts((list) => list.map((t) => (m.has(t.id) ? { ...t, features: m.get(t.id) } : t)));
      message.success(`Contact ${out.length} trust par lag gaya`);
    } catch (e) {
      if (e.status === 401) setState("key");
      message.error(e.message);
    } finally { setSaving(false); }
  };
  const setSupport = (k, v) => setDraft((d) => ({ ...d, support: { ...d.support, [k]: v } }));

  const logout = async () => { await call("DELETE", "/session").catch(() => {}); setTrusts([]); setState("key"); };

  if (state === "checking") return <div className="fc-center"><Spin /><style>{CSS}</style></div>;
  if (state === "missing") {
    return (
      <div className="fc-center fc-404"><h1>404</h1><p>This page could not be found.</p><style>{CSS}</style></div>
    );
  }
  if (state === "key") return <><KeyScreen onIn={() => setState("in")} /><style>{CSS}</style></>;

  const orig = sel ? normalizeFeatures(sel.features) : null;

  return (
    <div className="fc">
      <style>{CSS}</style>
      <header className="fc-top">
        <div className="fc-brand"><span className="fc-dot" /> Feature Control</div>
        <div className="fc-top-right">
          <span className="fc-muted">{trusts.length} trust</span>
          <a href="/data-migration"><Button icon={<FiDatabase />}>Data migration</Button></a>
          <Button icon={<FiLogOut />} onClick={logout}>Bahar</Button>
        </div>
      </header>

      <div className="fc-body">
        {/* ── trust list ── */}
        <aside className="fc-list">
          <Input allowClear prefix={<FiSearch />} placeholder="Trust khojein…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="fc-list-items">
            {loading && !trusts.length ? <div className="fc-pad"><Spin /></div> : null}
            {!loading && !shown.length ? <Empty description="Koi trust nahi" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : null}
            {shown.map((t) => {
              const f = normalizeFeatures(t.features);
              const n = offOf(f);
              return (
                <button key={t.id} type="button" onClick={() => pick(t.id)} className={`fc-trust ${t.id === selId ? "is-on" : ""}`}>
                  <div className="fc-trust-name">{t.name}</div>
                  <div className="fc-trust-mail">{t.email}</div>
                  <div className="fc-trust-tags">
                    {!f.active ? <Tag color="red">Band</Tag> : planState(f).expired ? <Tag color="red">Plan khatam</Tag> : <Tag color="green">Chalu</Tag>}
                    {f.expiresAt && !planState(f).expired && <Tag color={planState(f).warn ? "gold" : "blue"}>{planState(f).daysLeft} din</Tag>}
                    {n ? <Tag color="orange">{n} off</Tag> : <Tag>Sab on</Tag>}
                    <span className="fc-muted">{t.members.toLocaleString("en-IN")} members</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── editor ── */}
        <main className="fc-main">
          {!sel || !draft ? (
            <div className="fc-pad"><Empty description="Trust chuniye" /></div>
          ) : (
            <>
              <section className="fc-head">
                <div>
                  <h2>{sel.name}</h2>
                  <div className="fc-muted">{sel.email}{sel.phone ? ` · ${sel.phone}` : ""}</div>
                </div>
                <div className="fc-stats">
                  <div><b>{sel.members.toLocaleString("en-IN")}</b><span>Members</span></div>
                  <div><b>{sel.agents}</b><span>Agents</span></div>
                  <div><b>{sel.programs}</b><span>Yojna</span></div>
                  <div><b>{fmtDate(sel.lastLoginAt)}</b><span>Last login</span></div>
                </div>
              </section>

              <LoginDomain key={`ld-${sel.id}`} trust={sel} onSaved={(v) => setTrusts((list) => list.map((t) => (t.id === sel.id ? { ...t, ...v } : v.loginDefault ? { ...t, loginDefault: false } : t)))} onAuth={() => setState("key")} />

              {/* panel on / off */}
              <section className={`fc-card fc-power ${draft.active ? "" : "is-off"}`}>
                <div className="fc-power-row">
                  <div className="fc-power-icon"><FiPower /></div>
                  <div className="fc-row-text">
                    <div className="fc-row-title">Panel {draft.active ? "chalu hai" : "band hai"}</div>
                    <div className="fc-row-desc">Band karne par is trust ka koi bhi login (admin, staff, agent, member) kaam nahi karega.</div>
                  </div>
                  <Switch checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} />
                </div>
                {!draft.active && (
                  <Input.TextArea rows={2} maxLength={300} showCount value={draft.message}
                    onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
                    placeholder={DEFAULT_BLOCK_MESSAGE} className="fc-msg" />
                )}
              </section>

              {/* plan / subscription */}
              {(() => {
                const ps = planState(draft);
                const extend = (n, unit) => setDraft((d) => {
                  const base = d.expiresAt && dayjs(d.expiresAt).isAfter(dayjs()) ? dayjs(d.expiresAt) : dayjs();
                  return { ...d, expiresAt: base.add(n, unit).format("YYYY-MM-DD") };
                });
                return (
                  <section className={`fc-card fc-plan ${ps.expired ? "is-off" : ps.warn ? "is-warn" : ""}`}>
                    <div className="fc-power-row">
                      <div className="fc-power-icon"><FiCalendar /></div>
                      <div className="fc-row-text">
                        <div className="fc-row-title">
                          {!draft.expiresAt ? "Plan: koi aakhri tareekh nahi (hamesha chalu)"
                            : ps.expired ? `Plan khatam — ${-ps.daysLeft} din pehle`
                            : `Plan ${ps.daysLeft === 0 ? "aaj" : `${ps.daysLeft} din mein`} khatam`}
                        </div>
                        <div className="fc-row-desc">Aakhri tareekh ke agle din panel apne aap band. {draft.warnDays} din pehle trust ko panel mein warning dikhegi.</div>
                      </div>
                    </div>
                    <div className="fc-plan-ctrls">
                      <DatePicker value={draft.expiresAt ? dayjs(draft.expiresAt) : null} format="DD-MM-YYYY" placeholder="Aakhri tareekh"
                        onChange={(v) => setDraft((d) => ({ ...d, expiresAt: v ? v.format("YYYY-MM-DD") : null }))} />
                      <Button size="small" onClick={() => extend(1, "month")}>+1 mahina</Button>
                      <Button size="small" onClick={() => extend(3, "month")}>+3 mahine</Button>
                      <Button size="small" onClick={() => extend(1, "year")}>+1 saal</Button>
                      {draft.expiresAt && <Button size="small" type="text" danger onClick={() => setDraft((d) => ({ ...d, expiresAt: null }))}>Tareekh hatao</Button>}
                      <span className="fc-muted">Warning</span>
                      <InputNumber size="small" min={0} max={60} value={draft.warnDays} onChange={(v) => setDraft((d) => ({ ...d, warnDays: v ?? 7 }))} addonAfter="din pehle" style={{ width: 150 }} />
                    </div>
                  </section>
                );
              })()}

              {/* renew / support contact */}
              <section className="fc-card">
                <div className="fc-card-head">
                  <div className="fc-card-title"><FiPhone /> Renew / support contact</div>
                  {trusts.length > 1 && (
                    <Popconfirm title={`Ye contact sab ${trusts.length} trust par lagayein?`} okText="Haan" cancelText="Nahi" onConfirm={supportToAll}>
                      <Button size="small" icon={<FiCopy />} loading={saving}>Sab trust par lagao</Button>
                    </Popconfirm>
                  )}
                </div>
                <div className="fc-row-desc" style={{ marginBottom: 10 }}>Plan khatam hone ki warning (popup) aur &quot;panel band&quot; screen par yahi dikhega — Call, WhatsApp, E-mail button ke saath.</div>
                <div className="fc-support">
                  <Input placeholder="Naam / company (jaise Lalit Kumar)" maxLength={80} value={draft.support.name} onChange={(e) => setSupport("name", e.target.value)} />
                  <Input placeholder="Mobile (call)" maxLength={20} value={draft.support.phone} onChange={(e) => setSupport("phone", e.target.value)} />
                  <Input placeholder="WhatsApp (khaali = mobile wala)" maxLength={20} value={draft.support.whatsapp} onChange={(e) => setSupport("whatsapp", e.target.value)} />
                  <Input placeholder="E-mail" maxLength={120} value={draft.support.email} onChange={(e) => setSupport("email", e.target.value)} />
                  <Input.TextArea className="fc-support-note" rows={2} maxLength={300} showCount placeholder="Note (jaise: Renew ₹5000 / saal · UPI: xyz@upi · Subah 10–7 baje)" value={draft.support.note} onChange={(e) => setSupport("note", e.target.value)} />
                </div>
              </section>

              {/* presets */}
              <section className="fc-presets">
                <span className="fc-muted">Jaldi set karein:</span>
                {FEATURE_PRESETS.map((p) => (
                  <Tooltip key={p.key} title={p.desc}>
                    <Button size="small" onClick={() => setDraft((d) => ({ ...d, flags: presetFlags(p.key) }))}>{p.label}</Button>
                  </Tooltip>
                ))}
              </section>

              {FEATURE_GROUPS.map((g) => {
                const Icon = GROUP_ICON[g.key] || FiUsers;
                const onN = g.items.filter((f) => draft.flags[f.key]).length;
                return (
                  <section key={g.key} className="fc-card">
                    <div className="fc-card-head">
                      <div className="fc-card-title"><Icon /> {g.label} <span className="fc-hi">{g.hi}</span>
                        <span className="fc-count">{onN}/{g.items.length} on</span></div>
                      <div className="fc-card-actions">
                        <Button size="small" type="text" onClick={() => setGroup(g.items, true)}>Sab on</Button>
                        <Button size="small" type="text" danger onClick={() => setGroup(g.items, false)}>Sab off</Button>
                      </div>
                    </div>
                    <div className="fc-grid">
                      {g.items.map((f) => (
                        <FeatureRow key={f.key} f={f} on={draft.flags[f.key]} changed={draft.flags[f.key] !== orig.flags[f.key]}
                          onChange={(v) => setFlag(f.key, v)} />
                      ))}
                    </div>
                  </section>
                );
              })}

              <DangerZone key={sel.id} trust={sel} onDeleted={() => { setSelId(null); load(); }} onAuth={() => setState("key")} />

              <div className="fc-foot-space" />
              <footer className={`fc-foot ${dirty ? "is-dirty" : ""}`}>
                <div className="fc-muted">
                  {dirty ? <><FiAlertTriangle /> Badlav save nahi hue</> : <>Last update: {fmtDate(orig.updatedAt)}</>}
                </div>
                <div className="fc-foot-btns">
                  <Button icon={<FiRotateCcw />} disabled={!dirty} onClick={() => setDraft(normalizeFeatures(sel.features))}>Wapas</Button>
                  {!draft.active && orig.active ? (
                    <Popconfirm title="Is trust ka panel band karein?" description="Sab logins turant ruk jayenge." okText="Haan, band karo" okButtonProps={{ danger: true }} onConfirm={save}>
                      <Button type="primary" danger icon={<FiCheck />} loading={saving} disabled={!dirty}>Save</Button>
                    </Popconfirm>
                  ) : (
                    <Button type="primary" icon={<FiCheck />} loading={saving} disabled={!dirty} onClick={save}>Save</Button>
                  )}
                </div>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Login page domain → which trust's name / logo shows before login ─────────
function LoginDomain({ trust, onSaved, onAuth }) {
  const { message } = App.useApp();
  const [text, setText] = useState((trust.loginDomains || []).join(", "));
  const [def, setDef] = useState(!!trust.loginDefault);
  const [busy, setBusy] = useState(false);
  const here = typeof window !== "undefined" ? window.location.hostname : "";
  const changed = text !== (trust.loginDomains || []).join(", ") || def !== !!trust.loginDefault;
  const save = async () => {
    setBusy(true);
    try {
      const r = await call("PUT", `/trusts/${trust.id}/login-domain`, { domains: text, isDefault: def });
      setText(r.loginDomains.join(", ")); onSaved(r);
      message.success("Save — login page ab is domain par is trust ka naam / logo dikhayega");
    } catch (e) { if (e.status === 401) onAuth(); message.error(e.message); }
    setBusy(false);
  };
  return (
    <section className="fc-card">
      <div className="fc-card-head"><div className="fc-card-title"><FiGlobe /> Login page domain</div></div>
      <div className="fc-row-desc" style={{ marginBottom: 10 }}>
        Ek server par kai trust ho to login page (aur app ki pehli screen) par kis domain par kaun sa naam / logo dikhe. Khaali = &quot;default&quot; trust ya sabse purana.
      </div>
      <div className="fc-plan-ctrls">
        <Input style={{ maxWidth: 420 }} placeholder="admin.trust.in, srv123.hstgr.cloud" value={text} onChange={(e) => setText(e.target.value)} onPressEnter={save} />
        {here && !text.includes(here) ? <Button size="small" type="dashed" onClick={() => setText((t) => (t.trim() ? `${t.trim()}, ${here}` : here))}>+ {here}</Button> : null}
        <Checkbox checked={def} onChange={(e) => setDef(e.target.checked)}>Default trust (koi domain match na ho to)</Checkbox>
        <Button type="primary" size="small" loading={busy} disabled={!changed} onClick={save}>Save</Button>
      </div>
    </section>
  );
}

// ─── Delete a trust completely ─────────────────────────────────────────────────
function DangerZone({ trust, onDeleted, onAuth }) {
  const { message } = App.useApp();
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState(true);
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const show = async () => {
    setBusy(true);
    try { setInfo(await call("GET", `/trusts/${trust.id}/delete`)); setText(""); setBackedUp(false); setFiles(true); setOpen(true); }
    catch (e) { if (e.status === 401) onAuth(); message.error(e.message); }
    setBusy(false);
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await call("POST", `/trusts/${trust.id}/delete`, { confirm: text, deleteFiles: files });
      const n = Object.values(r.removed || {}).reduce((a, b) => a + b, 0);
      message.success(`Trust delete ho gaya — ${n.toLocaleString("en-IN")} rows, ${r.files.removed}/${r.files.total} files hataye${r.files.failed ? ` (${r.files.failed} files nahi hati)` : ""}`, 8);
      setOpen(false); onDeleted();
    } catch (e) { if (e.status === 401) onAuth(); message.error(e.message); }
    setBusy(false);
  };
  const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
  return (
    <section className="fc-card fc-danger">
      <div className="fc-power-row">
        <div className="fc-power-icon"><FiTrash2 /></div>
        <div className="fc-row-text">
          <div className="fc-row-title">Trust poora delete karein</div>
          <div className="fc-row-desc">Yojna, members, dues, payments, rasid, agents, commission, logins, WhatsApp — aur saari photo / documents. Wapas nahi aata. Sirf band karna ho to upar &quot;Panel band&quot; karein.</div>
        </div>
        <Button danger icon={<FiTrash2 />} loading={busy && !open} onClick={show}>Delete…</Button>
      </div>
      <Modal open={open} onCancel={() => setOpen(false)} destroyOnClose width={560}
        title={<span style={{ color: "#dc2626" }}>“{info?.name}” poora delete karein?</span>}
        okText="Haan, hamesha ke liye delete" okButtonProps={{ danger: true, loading: busy, disabled: !text.trim() }} onOk={run}>
        {info ? (
          <div className="fc-del">
            <div className="fc-del-grid">
              {Object.entries(info.counts).map(([k, n]) => (
                <div key={k}><b>{n.toLocaleString("en-IN")}</b><span>{info.labels[k] || k}</span></div>
              ))}
              <div><b>{info.files.toLocaleString("en-IN")}</b><span>Photo / document</span></div>
            </div>
            <div className="fc-muted">Kul jama: {inr(info.collected)} · aakhri payment: {fmtDate(info.lastPayment)} · aakhri login: {fmtDate(info.lastLogin)}</div>
            <div className="fc-del-step">
              <b>1.</b> Pehle backup lein (sab data JSON mein, passwords ke bina):
              <a href={`/api/control/trusts/${trust.id}/delete?backup=1`} onClick={() => setBackedUp(true)}>
                <Button size="small" icon={<FiDownload />}>Backup download</Button>
              </a>
              {backedUp ? <Tag color="green">liya</Tag> : null}
            </div>
            <Checkbox checked={files} onChange={(e) => setFiles(e.target.checked)}>
              Photo / documents bhi storage se hatao ({info.files} files · {info.storage === "local" ? "server folder" : "bucket"})
            </Checkbox>
            <div className="fc-del-step"><b>2.</b> Pakka karne ke liye admin e-mail likhein: <code>{info.email || info.id}</code></div>
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={info.email || info.id} onPressEnter={() => text.trim() && run()} />
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

const CSS = `
.fc-danger { border-color: #fecaca; background: #fff7f7; }
.fc-danger .fc-power-icon { background: #fee2e2; color: #dc2626; }
.fc-del { display: flex; flex-direction: column; gap: 12px; font-size: 13px; }
.fc-del-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.fc-del-grid div { border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px 8px; background: #f9fafb; display: flex; flex-direction: column; }
.fc-del-grid b { font-size: 16px; } .fc-del-grid span { font-size: 11px; color: #6b7280; }
.fc-del-step { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
@media (max-width: 560px) { .fc-del-grid { grid-template-columns: repeat(2, 1fr); } }
.fc, .fc-center { min-height: 100vh; background: #f4f5f7; color: #16181d; font-family: var(--font-geist-sans), system-ui, sans-serif; }
.fc-center { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px; }
.fc-404 h1 { font-size: 28px; font-weight: 600; } .fc-404 p { color: #6b7280; }
.fc-keycard { width: 100%; max-width: 360px; background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 28px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.06); }
.fc-keycard h1 { font-size: 20px; font-weight: 700; margin: 0; text-align: center; }
.fc-keycard p { margin: -6px 0 4px; color: #6b7280; text-align: center; font-size: 13px; }
.fc-lock { width: 48px; height: 48px; border-radius: 14px; background: #111827; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 20px; margin: 0 auto 4px; }
.fc-err { color: #dc2626; font-size: 13px; }
.fc-top { position: sticky; top: 0; z-index: 5; height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: #111827; color: #fff; }
.fc-brand { font-weight: 700; display: flex; align-items: center; gap: 10px; letter-spacing: .01em; }
.fc-dot { width: 9px; height: 9px; border-radius: 99px; background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,.2); }
.fc-top-right { display: flex; align-items: center; gap: 12px; }
.fc-top .fc-muted { color: #9ca3af; }
.fc-body { display: grid; grid-template-columns: 300px 1fr; min-height: calc(100vh - 56px); }
.fc-list { border-right: 1px solid #e5e7eb; background: #fff; padding: 14px; display: flex; flex-direction: column; gap: 10px; position: sticky; top: 56px; height: calc(100vh - 56px); }
.fc-list-items { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; margin: 0 -4px; padding: 0 4px; }
.fc-trust { text-align: left; border: 1px solid #eef0f3; border-radius: 12px; padding: 10px 12px; background: #fff; cursor: pointer; transition: all .12s; }
.fc-trust:hover { border-color: #c7cdd6; }
.fc-trust.is-on { border-color: #111827; box-shadow: 0 0 0 1px #111827; }
.fc-trust-name { font-weight: 600; font-size: 14px; }
.fc-trust-mail { font-size: 12px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fc-trust-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.fc-trust-tags .ant-tag { margin: 0; }
.fc-main { padding: 20px 24px; max-width: 1100px; width: 100%; display: flex; flex-direction: column; gap: 14px; }
.fc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
.fc-head h2 { font-size: 22px; font-weight: 700; margin: 0; }
.fc-stats { display: flex; gap: 8px; flex-wrap: wrap; }
.fc-stats > div { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 6px 12px; display: flex; flex-direction: column; min-width: 84px; }
.fc-stats b { font-size: 14px; font-variant-numeric: tabular-nums; } .fc-stats span { font-size: 11px; color: #6b7280; }
.fc-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 14px 16px; }
.fc-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.fc-card-title { font-weight: 700; display: flex; align-items: center; gap: 8px; }
.fc-count { font-size: 12px; font-weight: 600; color: #6b7280; background: #f3f4f6; border-radius: 99px; padding: 1px 8px; }
.fc-hi { font-weight: 500; color: #9ca3af; font-size: 12px; }
.fc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.fc-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #eef0f3; border-radius: 10px; cursor: pointer; transition: background .12s; }
.fc-row:hover { background: #fafafa; }
.fc-row.is-off { background: #fafafa; } .fc-row.is-off .fc-row-title { color: #6b7280; }
.fc-row.is-changed { border-color: #f59e0b; box-shadow: inset 3px 0 0 #f59e0b; }
.fc-row-text { flex: 1; min-width: 0; }
.fc-row-title { font-weight: 600; font-size: 14px; }
.fc-row-desc { font-size: 12px; color: #6b7280; margin-top: 1px; }
.fc-power { border-color: #bbf7d0; background: #f0fdf4; }
.fc-power.is-off { border-color: #fecaca; background: #fef2f2; }
.fc-power-row { display: flex; align-items: center; gap: 12px; }
.fc-power-icon { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: #16a34a; color: #fff; font-size: 18px; flex-shrink: 0; }
.fc-power.is-off .fc-power-icon { background: #dc2626; }
.fc-msg { margin-top: 10px; }
.fc-support { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.fc-support-note { grid-column: 1 / -1; margin-bottom: 14px; }
@media (max-width: 640px) { .fc-support { grid-template-columns: 1fr; } }
.fc-plan { border-color: #bfdbfe; background: #eff6ff; } .fc-plan .fc-power-icon { background: #2563eb; }
.fc-plan.is-warn { border-color: #fcd34d; background: #fffbeb; } .fc-plan.is-warn .fc-power-icon { background: #d97706; }
.fc-plan.is-off { border-color: #fecaca; background: #fef2f2; } .fc-plan.is-off .fc-power-icon { background: #dc2626; }
.fc-plan-ctrls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; padding-left: 50px; }
@media (max-width: 860px) { .fc-plan-ctrls { padding-left: 0; } }
.fc-presets { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.fc-muted { color: #6b7280; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
.fc-pad { padding: 40px; display: flex; justify-content: center; }
.fc-foot-space { height: 56px; }
.fc-foot { position: fixed; left: 300px; right: 0; bottom: 0; background: #fff; border-top: 1px solid #e5e7eb; padding: 10px 24px; display: flex; align-items: center; justify-content: space-between; gap: 10px; z-index: 4; }
.fc-foot.is-dirty { background: #fffbeb; border-top-color: #fcd34d; }
.fc-foot.is-dirty .fc-muted { color: #92400e; font-weight: 600; }
.fc-foot-btns { display: flex; gap: 8px; }
@media (max-width: 860px) {
  .fc-body { grid-template-columns: 1fr; }
  .fc-list { position: static; height: auto; border-right: 0; border-bottom: 1px solid #e5e7eb; }
  .fc-list-items { max-height: 260px; }
  .fc-grid { grid-template-columns: 1fr; }
  .fc-main { padding: 16px; }
  .fc-foot { left: 0; padding: 10px 16px; }
}
`;
