"use client";
// Payments → Agent cash hisaab: cash each agent collected vs. handed over to the trust.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { App, Button, DatePicker, Drawer, Empty, Input, InputNumber, Modal, Popconfirm, Segmented, Spin, Table, Tag, Tooltip } from "antd";
import { FiDollarSign, FiRefreshCw, FiDownloadCloud, FiList, FiTrash2, FiSearch, FiMessageCircle } from "react-icons/fi";
import dayjs from "dayjs";
import { api } from "@/lib/client/api";
import { useCan, useFeature } from "@/lib/AuthProvider";
import { amountsHidden, useAmountsHidden, MASK } from "@/lib/client/privacy";

const rs = (n) => (amountsHidden() ? MASK : `₹${Number(n || 0).toLocaleString("en-IN")}`);
const fmtDay = (d) => (d ? dayjs(d).format("DD MMM YYYY") : "—");
const MODES = [{ value: "cash", label: "Nakad" }, { value: "bank", label: "Bank jama" }, { value: "upi", label: "UPI" }];

function Tile({ label, value, sub, tone = "gray" }) {
  const tones = { gray: "bg-white border-gray-200", red: "bg-red-50 border-red-200", green: "bg-emerald-50 border-emerald-200", blue: "bg-blue-50 border-blue-200" };
  return (
    <div className={`rounded-xl border p-3.5 ${tones[tone]}`}>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function AgentCashPage() {
  useAmountsHidden();
  const { message } = App.useApp();
  const can = useCan();
  const feature = useFeature();
  const program = useSelector((s) => s.data.selectedProgram);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("holding");
  const [jama, setJama] = useState(null);     // agent row being settled
  const [form, setForm] = useState({ amount: 0, day: dayjs(), mode: "cash", note: "" });
  const [saving, setSaving] = useState(false);
  const [ledger, setLedger] = useState({ open: false, loading: false, data: null });

  const load = useCallback(async () => {
    if (!program?.id) return;
    setLoading(true);
    try { setData(await api.get(`/programs/${program.id}/cash-handovers`)); }
    catch (e) { message.error(e.message); }
    finally { setLoading(false); }
  }, [program?.id, message]);
  useEffect(() => { load(); }, [load]);

  const openLedger = async (agentId) => {
    setLedger({ open: true, loading: true, data: null });
    try { setLedger({ open: true, loading: false, data: await api.get(`/programs/${program.id}/cash-handovers`, { agentId }) }); }
    catch (e) { message.error(e.message); setLedger({ open: false, loading: false, data: null }); }
  };

  const startJama = (a) => { setJama(a); setForm({ amount: Math.max(0, a.balance), day: dayjs(), mode: "cash", note: "" }); };
  const saveJama = async () => {
    if (!(form.amount > 0)) { message.warning("Rakam daalein"); return; }
    setSaving(true);
    try {
      await api.post(`/programs/${program.id}/cash-handovers`, { agentId: jama.agentId, amount: form.amount, handedOn: form.day.format("YYYY-MM-DD"), mode: form.mode, note: form.note });
      message.success(`${jama.name} se ₹${form.amount.toLocaleString("en-IN")} jama darj`);
      setJama(null);
      load();
      if (ledger.open && ledger.data?.agent?.id === jama.agentId) openLedger(jama.agentId);
    } catch (e) { message.error(e.message); } finally { setSaving(false); }
  };
  const removeHandover = async (id) => {
    try {
      await api.del(`/programs/${program.id}/cash-handovers/${id}`);
      message.success("Entry hata di");
      load();
      if (ledger.data?.agent?.id) openLedger(ledger.data.agent.id);
    } catch (e) { message.error(e.message); }
  };

  // WhatsApp reminder to an agent holding cash (free — opens WhatsApp with the text filled in)
  const waLink = (a) => {
    const phone = String(a.phone || "").replace(/\D/g, "").slice(-10);
    const text = `नमस्ते ${a.name} जी,\n${program?.name || ""} योजना का आपके पास ₹${a.balance.toLocaleString("en-IN")} नकद जमा करना बाकी है। कृपया जल्द ट्रस्ट कार्यालय में जमा करें।\nधन्यवाद`;
    return phone.length === 10 ? `https://wa.me/91${phone}?text=${encodeURIComponent(text)}` : null;
  };

  const rows = useMemo(() => {
    const list = data?.agents || [];
    const s = q.trim().toLowerCase();
    return list.filter((a) => (only === "all" || a.balance > 0 || a.collected > 0 && only === "active") && (!s || `${a.name} ${a.phone}`.toLowerCase().includes(s)));
  }, [data, q, only]);

  if (!feature("cashHandover")) return <Empty className="py-20" description="Ye feature is panel mein chalu nahi hai" />;
  if (!program) return <Empty className="py-20" description="Pehle yojna chuniye" />;

  const T = data?.totals;
  const columns = [
    { title: "Agent", dataIndex: "name", render: (v, a) => <div><div className="font-semibold text-gray-900">{v}</div><div className="text-xs text-gray-500">{a.phone}</div></div> },
    { title: "Liya (cash)", dataIndex: "collected", align: "right", sorter: (a, b) => a.collected - b.collected,
      render: (v, a) => <div className="tabular-nums"><div>{rs(v)}</div><div className="text-[11px] text-gray-400">{a.entries} entries{a.joinFees ? ` · join ${rs(a.joinFees)}` : ""}</div></div> },
    { title: "Jama kiya", dataIndex: "handed", align: "right", render: (v) => <span className="tabular-nums">{rs(v)}</span> },
    { title: "Agent ke paas baki", dataIndex: "balance", align: "right", defaultSortOrder: "descend", sorter: (a, b) => a.balance - b.balance,
      render: (v) => <span className={`font-bold tabular-nums ${v > 0 ? "text-red-600" : v < 0 ? "text-blue-600" : "text-emerald-600"}`}>{v < 0 ? `${rs(-v)} zyada` : rs(v)}</span> },
    { title: "Aaj", key: "today", align: "right", render: (_, a) => <div className="text-xs tabular-nums"><div>Liya {rs(a.todayCollected)}</div><div className="text-gray-500">Jama {rs(a.todayHanded)}</div></div> },
    { title: "Aakhri jama", dataIndex: "lastHanded", render: (v) => <span className="text-xs text-gray-600">{fmtDay(v)}</span> },
    {
      title: "", key: "act", align: "right", width: 220,
      render: (_, a) => (
        <div className="flex justify-end gap-1.5">
          {can("payments", "add") && <Button size="small" type="primary" icon={<FiDownloadCloud />} onClick={() => startJama(a)}>Jama</Button>}
          <Tooltip title="Din-wise hisaab"><Button size="small" icon={<FiList />} onClick={() => openLedger(a.agentId)} /></Tooltip>
          {a.balance > 0 && feature("whatsapp") && waLink(a) && <Tooltip title="WhatsApp pe yaad dilayein"><Button size="small" icon={<FiMessageCircle />} href={waLink(a)} target="_blank" /></Tooltip>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 m-0 flex items-center gap-2"><FiDollarSign /> Agent cash hisaab</h1>
          <div className="text-sm text-gray-500">{program.name} · agent ne apne login se jo cash liya, aur trust mein kitna jama kiya</div>
        </div>
        <div className="flex-1" />
        <Button icon={<FiRefreshCw />} onClick={load} loading={loading}>Reload</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Agents ke paas baki (kul)" value={T ? rs(T.balance) : "…"} sub={T ? `${T.agentsHolding} agent ke paas cash` : ""} tone={T?.balance > 0 ? "red" : "green"} />
        <Tile label="Aaj agents ne liya" value={T ? rs(T.todayCollected) : "…"} tone="blue" />
        <Tile label="Aaj jama hua" value={T ? rs(T.todayHanded) : "…"} tone="green" />
        <Tile label="Ab tak kul liya / jama" value={T ? `${rs(T.collected)}` : "…"} sub={T ? `jama ${rs(T.handed)}` : ""} />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input allowClear prefix={<FiSearch className="text-gray-400" />} placeholder="Agent khojein…" style={{ width: 240 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <Segmented value={only} onChange={setOnly} options={[{ value: "holding", label: "Jinke paas baki" }, { value: "active", label: "Collection wale" }, { value: "all", label: "Sab agents" }]} />
      </div>

      <Table rowKey="agentId" size="middle" loading={loading} columns={columns} dataSource={rows} pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: 900 }} locale={{ emptyText: <Empty description={only === "holding" ? "Kisi agent ke paas cash baki nahi 👍" : "Koi agent nahi"} /> }} />

      <Modal open={!!jama} title={jama ? `${jama.name} — cash jama` : ""} onCancel={() => setJama(null)} onOk={saveJama} okText="Jama darj karein" confirmLoading={saving} destroyOnHidden>
        {jama && (
          <div className="space-y-3 pt-1">
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">Agent ke paas abhi: <b className={jama.balance > 0 ? "text-red-600" : ""}>{rs(jama.balance)}</b></div>
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">Rakam</div>
              <InputNumber className="!w-full" size="large" min={1} value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v || 0 }))} addonBefore="₹" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-1">Tareekh</div>
                <DatePicker className="w-full" value={form.day} onChange={(v) => setForm((f) => ({ ...f, day: v || dayjs() }))} format="DD-MM-YYYY" disabledDate={(d) => d.isAfter(dayjs(), "day")} />
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-1">Kaise</div>
                <Segmented block value={form.mode} onChange={(v) => setForm((f) => ({ ...f, mode: v }))} options={MODES} />
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">Note (optional)</div>
              <Input value={form.note} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Jaise: bank slip no., kisne liya" />
            </div>
          </div>
        )}
      </Modal>

      <Drawer open={ledger.open} onClose={() => setLedger({ open: false, loading: false, data: null })} width={Math.min(720, typeof window !== "undefined" ? window.innerWidth : 720)}
        title={ledger.data ? `${ledger.data.agent.name} — din-wise hisaab` : "Hisaab"}>
        {ledger.loading || !ledger.data ? <div className="py-16 flex justify-center"><Spin /></div> : (
          <div className="space-y-5">
            <div className="rounded-xl border border-gray-200 p-3 flex items-center justify-between">
              <span className="text-sm text-gray-600">Abhi agent ke paas</span>
              <b className={`text-lg ${ledger.data.balance > 0 ? "text-red-600" : "text-emerald-600"}`}>{rs(ledger.data.balance)}</b>
            </div>
            <Table size="small" rowKey="day" pagination={{ pageSize: 30, hideOnSinglePage: true }} dataSource={ledger.data.days}
              columns={[
                { title: "Din", dataIndex: "day", render: fmtDay },
                { title: "Liya", dataIndex: "collected", align: "right", render: (v, r) => v ? <span className="tabular-nums">{rs(v)} <span className="text-[11px] text-gray-400">({r.entries})</span></span> : "—" },
                { title: "Jama", dataIndex: "handed", align: "right", render: (v) => (v ? <span className="tabular-nums text-emerald-700">{rs(v)}</span> : "—") },
                { title: "Baki (us din tak)", dataIndex: "balance", align: "right", render: (v) => <b className={`tabular-nums ${v > 0 ? "text-red-600" : ""}`}>{rs(v)}</b> },
              ]} />
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Jama entries</div>
              {!ledger.data.handovers.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Abhi tak koi jama nahi" /> : (
                <div className="space-y-1.5">
                  {ledger.data.handovers.map((h) => (
                    <div key={h.id} className="flex items-center gap-2 text-sm rounded-lg bg-gray-50 px-3 py-2">
                      <b className="tabular-nums">{rs(h.amount)}</b>
                      <Tag className="!m-0">{MODES.find((m) => m.value === h.mode)?.label || h.mode}</Tag>
                      <span className="text-gray-600">{fmtDay(h.handedOn)}</span>
                      <span className="text-gray-400 truncate flex-1">{[h.note, h.receivedBy && `by ${h.receivedBy}`].filter(Boolean).join(" · ")}</span>
                      {can("payments", "delete") && (
                        <Popconfirm title="Ye jama entry hatayein?" okText="Haan" okButtonProps={{ danger: true }} onConfirm={() => removeHandover(h.id)}>
                          <Button size="small" type="text" danger icon={<FiTrash2 />} />
                        </Popconfirm>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
