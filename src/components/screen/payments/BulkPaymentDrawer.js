"use client";
// Closing payment for many members at once (Closing Payments page → select members → Bulk payment).
//   - one call loads every open due of the chosen members + their advance (अग्रिम)
//   - amounts are the real open amount of each due (partial payments counted), not count × pay amount
//   - per member: tick / untick closings (row opens), closing-group filter, search
//   - "Advance se kaatein": each member's own advance pays his own closings first
//   - cash / UPI / online / bank / cheque, reference check, IST date (no off-by-one)
//   - after saving: per-member result (paid, from advance, to collect)
import { useEffect, useMemo, useState } from "react";
import { App, Avatar, Button, DatePicker, Drawer, Empty, Input, Segmented, Spin, Switch, Tag, Tooltip } from "antd";
import { FiSearch, FiChevronDown, FiChevronRight, FiCheckCircle, FiZap, FiAlertTriangle } from "react-icons/fi";
import dayjs from "dayjs";
import { FixedLimitTag } from "@/components/common/fixedLimit/FixedLimit";
import { api } from "@/lib/client/api";
import { useFeature } from "@/lib/AuthProvider";

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const dmy = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("-") : "");
const METHODS = [
  { value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }, { value: "online", label: "Online" },
  { value: "bank", label: "Bank" }, { value: "cheque", label: "Cheque" },
];
const GROUP_COLORS = ["#6366f1", "#10b981", "#f97316", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f59e0b", "#ef4444", "#06b6d4"];
const groupColor = (id) => (id ? GROUP_COLORS[[...id].reduce((h, c) => h + c.charCodeAt(0), 0) % GROUP_COLORS.length] : "#d1d5db");

async function referenceTaken(programId, ref) {
  try {
    await api.post("/payments/process", { type: "single", programId, payerId: "_check_only_", onlineReference: ref, paymentMethod: "online", _checkOnly: true });
    return false;
  } catch (e) { return e.status === 409; }
}

export default function BulkPaymentDrawer({ open, onClose, selectedRows: rowsIn = [], programId, programName, onSuccess, closingGroupList = [] }) {
  const { message, modal } = App.useApp();
  const advanceOn = useFeature()("advancePayment");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({});           // memberId → { advance, dues }
  const [sel, setSel] = useState({});             // memberId → Set(dueId)
  const [openRow, setOpenRow] = useState(null);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState(null);
  const [useAdv, setUseAdv] = useState(true);
  const [method, setMethod] = useState("cash");
  const [day, setDay] = useState(dayjs());
  const [ref, setRef] = useState("");
  const [refBad, setRefBad] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  // the members chosen when the drawer opened (the page clears its selection after saving)
  const [selectedRows, setRowsSnap] = useState([]);
  useEffect(() => { if (open) setRowsSnap(rowsIn); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupName = useMemo(() => Object.fromEntries(closingGroupList.map((g) => [g.id, g.name])), [closingGroupList]);

  // load once per open
  useEffect(() => {
    if (!open) return;
    setResult(null); setQ(""); setGroup(null); setMethod("cash"); setDay(dayjs()); setRef(""); setRefBad(false); setNote(""); setOpenRow(null);
    if (!rowsIn.length || !programId) { setData({}); return; }
    setLoading(true);
    api.post(`/programs/${programId}/open-dues`, { memberIds: rowsIn.map((r) => r.id) })
      .then((r) => {
        setData(r.members || {});
        setSel(Object.fromEntries(Object.entries(r.members || {}).map(([id, m]) => [id, new Set(m.dues.map((d) => d.id))])));
        setUseAdv(Object.values(r.members || {}).some((m) => m.advance > 0));
      })
      .catch((e) => message.error(e.message || "Baki closing load nahi hui"))
      .finally(() => setLoading(false));
  }, [open, programId]); // eslint-disable-line react-hooks/exhaustive-deps

  // closing-group filter: pre-select only that group's closings
  const applyGroup = (g) => {
    setGroup(g);
    setSel(Object.fromEntries(Object.entries(data).map(([id, m]) => [id, new Set(m.dues.filter((d) => !g || d.closingGroupId === g).map((d) => d.id))])));
  };
  const groups = useMemo(() => {
    const c = new Map();
    for (const m of Object.values(data)) for (const d of m.dues) if (d.closingGroupId) c.set(d.closingGroupId, (c.get(d.closingGroupId) || 0) + 1);
    return [...c.entries()].map(([id, n]) => ({ id, n, name: groupName[id] || "Group" }));
  }, [data, groupName]);

  // per-member numbers
  const rows = useMemo(() => selectedRows.map((m) => {
    const d = data[m.id] || { advance: 0, dues: [] };
    const s = sel[m.id] || new Set();
    const chosen = d.dues.filter((x) => s.has(x.id));
    const total = chosen.reduce((a, x) => a + x.remaining, 0);
    const adv = advanceOn && useAdv ? Math.min(d.advance || 0, total) : 0;
    return { m, dues: d.dues, advance: advanceOn ? d.advance || 0 : 0, limit: d.fixedLimit != null ? { limit: d.fixedLimit, paid: d.paidTotal || 0 } : null, chosen, total, adv, collect: total - adv, pendingAll: d.dues.reduce((a, x) => a + x.remaining, 0) };
  }), [selectedRows, data, sel, useAdv, advanceOn]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? rows.filter((r) => `${r.m.displayName} ${r.m.registrationNumber || ""} ${r.m.phone || ""} ${r.m.fatherName || ""} ${r.m.village || ""}`.toLowerCase().includes(s)) : rows;
    return [...list].sort((a, b) => (b.dues.length > 0) - (a.dues.length > 0));
  }, [rows, q]);
  const paying = rows.filter((r) => r.chosen.length);
  const T = paying.reduce((t, r) => ({ closings: t.closings + r.chosen.length, total: t.total + r.total, adv: t.adv + r.adv, collect: t.collect + r.collect }), { closings: 0, total: 0, adv: 0, collect: 0 });
  const noDues = rows.filter((r) => !r.dues.length).length;
  const anyAdvance = rows.some((r) => r.advance > 0);
  const needRef = method !== "cash" && T.collect > 0;

  const toggle = (mid, did) => setSel((o) => { const n = new Set(o[mid] || []); if (n.has(did)) n.delete(did); else n.add(did); return { ...o, [mid]: n }; });
  const setAll = (mid, on) => setSel((o) => ({ ...o, [mid]: new Set(on ? (data[mid]?.dues || []).filter((d) => !group || d.closingGroupId === group).map((d) => d.id) : []) }));
  const allOn = (on) => setSel(Object.fromEntries(Object.entries(data).map(([id, m]) => [id, new Set(on ? m.dues.filter((d) => !group || d.closingGroupId === group).map((d) => d.id) : [])])));

  const submit = async () => {
    if (!paying.length) return message.error("Koi closing nahi chuni");
    if (needRef && !ref.trim()) return message.error("UPI / online / cheque ka reference daalein");
    if (needRef && (await referenceTaken(programId, ref.trim()))) { setRefBad(true); return message.error("Ye reference pehle se darj hai"); }
    modal.confirm({
      title: `${paying.length} sadasyon ka bhugtan jama karein?`,
      width: 460,
      content: (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span>{T.closings} closing — kul</span><b>{inr(T.total)}</b></div>
          {T.adv > 0 ? <div className="flex justify-between text-emerald-700"><span>Advance se kata</span><b>− {inr(T.adv)}</b></div> : null}
          <div className="flex justify-between border-t pt-1"><span>Abhi lena hai ({METHODS.find((x) => x.value === method)?.label})</span><b>{inr(T.collect)}</b></div>
          <div className="text-xs text-gray-500">Tareekh: {day.format("DD-MM-YYYY")}</div>
        </div>
      ),
      okText: "Haan, jama karein", cancelText: "Nahi",
      onOk: async () => {
        setSaving(true);
        try {
          const memberClosingSelections = Object.fromEntries(paying.map((r) => [r.m.id, r.chosen.map((d) => d.id)]));
          const r = await api.post("/payments/process", {
            type: "bulk", programId, memberIds: paying.map((x) => x.m.id), memberClosingSelections,
            paymentMethod: method, paymentDate: day.format("YYYY-MM-DD"), note: note.trim(),
            onlineReference: method === "cash" ? "" : ref.trim(), ...(T.adv > 0 ? { useAdvance: true } : {}),
          });
          setResult(r);
          message.success(`${inr(r.totalPaid)} jama — ${r.membersProcessed} sadasya, ${r.closingsProcessed} closing`);
          onSuccess?.();
        } catch (e) {
          if (e.status === 409 && /reference/i.test(e.message)) setRefBad(true);
          message.error(e.message || "Bhugtan nahi hua", 6);
        } finally { setSaving(false); }
      },
    });
  };

  const byId = useMemo(() => Object.fromEntries(selectedRows.map((m) => [m.id, m])), [selectedRows]);

  return (
    <Drawer open={open} onClose={onClose} width={780} destroyOnHidden
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow"><FiZap /></div>
          <div>
            <div className="text-base font-bold text-gray-900">Ek saath bhugtan (Bulk)</div>
            <div className="text-xs text-gray-400">{selectedRows.length} sadasya · {programName}</div>
          </div>
        </div>
      }
      footer={result ? (
        <div className="flex justify-end p-2"><Button type="primary" size="large" onClick={onClose}>Band karein</Button></div>
      ) : (
        <div className="flex items-center gap-3 p-2">
          <div className="flex-1 text-xs text-gray-500">
            {paying.length} sadasya · {T.closings} closing{T.adv > 0 ? <> · <span className="text-emerald-700">advance {inr(T.adv)}</span></> : null}
          </div>
          <Button size="large" onClick={onClose}>Cancel</Button>
          <Button type="primary" size="large" loading={saving} disabled={!paying.length || loading || (needRef && !ref.trim())} onClick={submit}
            style={{ background: "linear-gradient(90deg,#f59e0b,#f97316)", border: 0 }}>
            {T.adv > 0 ? (T.collect > 0 ? `Jama karein · ${inr(T.collect)} lena` : "Jama karein · poora advance se") : `Jama karein · ${inr(T.total)}`}
          </Button>
        </div>
      )}>

      {result ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-emerald-50 p-5 text-center">
            <FiCheckCircle className="mx-auto mb-2 text-4xl text-emerald-600" />
            <div className="text-3xl font-extrabold text-emerald-700">{inr(result.totalPaid)}</div>
            <div className="text-sm text-gray-600">{result.membersProcessed} sadasya · {result.closingsProcessed} closing jama{result.fromAdvance ? ` · advance se ${inr(result.fromAdvance)}` : ""}</div>
            <div className="mt-1 text-xs text-gray-400">Batch: {result.batchId} · {day.format("DD-MM-YYYY")}</div>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <div className="grid grid-cols-12 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
              <div className="col-span-5">Sadasya</div><div className="col-span-2 text-center">Closing</div>
              <div className="col-span-2 text-right">Advance</div><div className="col-span-3 text-right">Liya / kul</div>
            </div>
            {(result.perMember || []).map((x) => (
              <div key={x.memberId} className="grid grid-cols-12 border-t px-3 py-2 text-sm">
                <div className="col-span-5 truncate font-medium">{byId[x.memberId]?.displayName || x.memberId}<span className="ml-1 text-xs text-gray-400">{byId[x.memberId]?.registrationNumber}</span></div>
                <div className="col-span-2 text-center">{x.closings}</div>
                <div className="col-span-2 text-right text-emerald-700">{x.fromAdvance ? inr(x.fromAdvance) : "—"}</div>
                <div className="col-span-3 text-right"><b>{inr(x.paid - x.fromAdvance)}</b> <span className="text-xs text-gray-400">/ {inr(x.paid)}</span></div>
              </div>
            ))}
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-24"><Spin /><span className="ml-2 text-sm text-gray-400">Baki closing load ho rahi hain…</span></div>
      ) : (
        <div className="space-y-4">
          {/* totals */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Sadasya (chune)", `${paying.length} / ${selectedRows.length}`, "#6366f1", "#eef2ff"],
              ["Closing", T.closings, "#0ea5e9", "#f0f9ff"],
              ["Kul baki (chuni)", inr(T.total), "#f97316", "#fff7ed"],
              [T.adv > 0 ? "Abhi lena hai" : "Lena hai", inr(T.collect), "#059669", "#ecfdf5"],
            ].map(([l, v, c, bg]) => (
              <div key={l} className="rounded-xl px-3 py-2.5" style={{ background: bg }}>
                <div className="text-lg font-black" style={{ color: c }}>{v}</div>
                <div className="text-[11px] text-gray-500">{l}</div>
              </div>
            ))}
          </div>

          {/* advance */}
          {advanceOn && anyAdvance ? (
            <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${useAdv ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white"}`}>
              <Switch checked={useAdv} onChange={setUseAdv} />
              <div className="flex-1">
                <div className="font-semibold text-gray-900">Advance se kaatein</div>
                <div className="text-xs text-gray-500">Har sadasya ka apna advance pehle uski apni closing mein lagega (sabse purani pehle)</div>
              </div>
              {useAdv ? <div className="text-right"><div className="text-lg font-black text-emerald-700">− {inr(T.adv)}</div><div className="text-[11px] text-gray-500">advance se</div></div> : null}
            </div>
          ) : null}

          {/* filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Input allowClear prefix={<FiSearch className="text-gray-400" />} placeholder="Naam, reg. no., phone, gaon…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            <Button size="small" onClick={() => allOn(true)}>Sab chunein</Button>
            <Button size="small" onClick={() => allOn(false)}>Sab hatayein</Button>
            {noDues ? <span className="text-xs text-gray-400">{noDues} sadasya ka koi baki nahi</span> : null}
          </div>
          {groups.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-gray-500">Closing group:</span>
              <Tag.CheckableTag checked={!group} onChange={() => applyGroup(null)}>Sab</Tag.CheckableTag>
              {groups.map((g) => (
                <Tag.CheckableTag key={g.id} checked={group === g.id} onChange={() => applyGroup(group === g.id ? null : g.id)}
                  style={group === g.id ? { background: groupColor(g.id) } : { color: groupColor(g.id), borderColor: `${groupColor(g.id)}55` }}>
                  {g.name} ({g.n})
                </Tag.CheckableTag>
              ))}
            </div>
          ) : null}

          {/* members */}
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <div className="grid grid-cols-12 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <div className="col-span-5">Sadasya</div>
              <div className="col-span-2 text-center">Closing</div>
              <div className="col-span-2 text-right">Baki</div>
              <div className="col-span-3 text-right">{advanceOn && anyAdvance && useAdv ? "Advance / lena" : "Lena"}</div>
            </div>
            <div style={{ maxHeight: 460, overflowY: "auto" }}>
              {!shown.length ? <Empty className="py-8" description="Koi sadasya nahi mila" /> : shown.map((r) => {
                const isOpen = openRow === r.m.id;
                const none = !r.dues.length;
                return (
                  <div key={r.m.id} className={`border-t first:border-t-0 ${none ? "bg-gray-50 opacity-60" : r.chosen.length ? "bg-white" : "bg-amber-50/40"}`}>
                    <div className={`grid grid-cols-12 items-center gap-1 px-3 py-2.5 ${none ? "" : "cursor-pointer hover:bg-gray-50"}`} onClick={() => !none && setOpenRow(isOpen ? null : r.m.id)}>
                      <div className="col-span-5 flex min-w-0 items-center gap-2">
                        {none ? <span className="w-4" /> : isOpen ? <FiChevronDown className="shrink-0 text-gray-400" /> : <FiChevronRight className="shrink-0 text-gray-400" />}
                        <Avatar size={30} src={r.m.photoURL || undefined} style={{ background: `hsl(${((r.m.displayName || "?").charCodeAt(0) * 7) % 360},55%,55%)`, flexShrink: 0 }}>{r.m.displayName?.[0]}</Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-gray-900">{r.m.displayName}</div>
                          <div className="truncate text-xs text-gray-400">{[r.m.registrationNumber, r.m.phone].filter(Boolean).join(" · ")}</div>
                        </div>
                        <span className="ml-auto flex shrink-0 gap-1">
                          {r.limit ? <FixedLimitTag limit={r.limit.limit} paid={r.limit.paid} /> : null}
                          {r.advance > 0 ? <Tooltip title="Advance jama"><Tag color="green" className="!m-0">Adv {inr(r.advance)}</Tag></Tooltip> : null}
                        </span>
                      </div>
                      <div className="col-span-2 text-center text-sm">
                        {none ? <span className="text-xs text-gray-400">Baki nahi</span> : <span className={r.chosen.length ? "font-bold text-indigo-600" : "text-gray-400"}>{r.chosen.length}/{r.dues.length}</span>}
                      </div>
                      <div className="col-span-2 text-right text-sm font-semibold text-gray-700">{r.total ? inr(r.total) : "—"}</div>
                      <div className="col-span-3 text-right text-sm">
                        {r.adv > 0 ? <span className="mr-1 text-xs text-emerald-700">−{inr(r.adv)}</span> : null}
                        <b className={r.collect ? "text-gray-900" : "text-emerald-700"}>{r.chosen.length ? (r.collect ? inr(r.collect) : "advance se") : "—"}</b>
                      </div>
                    </div>
                    {isOpen ? (
                      <div className="border-t border-dashed bg-gray-50/70 px-4 py-2">
                        <div className="mb-1 flex gap-3 text-xs">
                          <button type="button" className="font-semibold text-indigo-600" onClick={() => setAll(r.m.id, true)}>Sab chunein</button>
                          <button type="button" className="font-semibold text-gray-500" onClick={() => setAll(r.m.id, false)}>Sab hatayein</button>
                          <span className="ml-auto text-gray-400">Kul baki {inr(r.pendingAll)}</span>
                        </div>
                        {r.dues.map((d) => {
                          const on = (sel[r.m.id] || new Set()).has(d.id);
                          return (
                            <label key={d.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white">
                              <input type="checkbox" checked={on} onChange={() => toggle(r.m.id, d.id)} style={{ width: 16, height: 16, accentColor: "#6366f1" }} />
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: groupColor(d.closingGroupId) }} />
                              <span className="flex-1 truncate text-sm">{d.closingName}<span className="ml-1 text-xs text-gray-400">{d.closingRegNo} · {dmy(d.closingDate)}{d.closingGroupId ? ` · ${groupName[d.closingGroupId] || ""}` : ""}</span></span>
                              {d.paidAmount > 0 ? <Tag color="blue" className="m-0">aadha jama {inr(d.paidAmount)}</Tag> : null}
                              <span className={`w-20 text-right text-sm font-semibold ${on ? "text-gray-900" : "text-gray-400"}`}>{inr(d.remaining)}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* payment */}
          <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm font-semibold text-gray-700">{T.adv > 0 && !T.collect ? "Tareekh" : "Baki rakam kaise mili"}</div>
            {!(T.adv > 0 && !T.collect) ? <Segmented value={method} onChange={(v) => { setMethod(v); setRefBad(false); }} options={METHODS} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <DatePicker value={day} onChange={(v) => setDay(v || dayjs())} format="DD-MM-YYYY" allowClear={false} size="large" className="w-full" disabledDate={(d) => d.isAfter(dayjs(), "day")} />
              {needRef ? (
                <Input size="large" value={ref} status={refBad ? "error" : undefined} onChange={(e) => { setRef(e.target.value); setRefBad(false); }}
                  placeholder="UTR / reference / cheque no." suffix={refBad ? <FiAlertTriangle className="text-red-500" /> : null} />
              ) : null}
            </div>
            {refBad ? <div className="text-xs text-red-600">Ye reference pehle se kisi bhugtan mein hai</div> : null}
            <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note (optional)" />
          </div>
        </div>
      )}
    </Drawer>
  );
}
