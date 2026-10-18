"use client";
// Advance (अग्रिम) of one member: balance, "Advance jama karein", history, refund, cancel a wrong entry.
// Used from Payment Details (member) and from Add Payment (while paying closings).
import { useCallback, useEffect, useState } from "react";
import { App, Button, DatePicker, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Table, Tag, Tooltip } from "antd";
import { FiPlus, FiRotateCcw, FiArrowDownLeft, FiArrowUpRight, FiCornerUpLeft, FiSlash } from "react-icons/fi";
import dayjs from "dayjs";
import { api } from "@/lib/client/api";
import { useAuth } from "@/lib/AuthProvider";

const METHODS = [
  { value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }, { value: "online", label: "Online" },
  { value: "bank", label: "Bank" }, { value: "cheque", label: "Cheque" },
];
const KIND = {
  deposit: { color: "green", label: "Jama", icon: <FiArrowDownLeft className="inline mr-1" /> },
  use: { color: "blue", label: "Closing mein kata", icon: <FiArrowUpRight className="inline mr-1" /> },
  return: { color: "cyan", label: "Wapas aaya", icon: <FiCornerUpLeft className="inline mr-1" /> },
  refund: { color: "orange", label: "Member ko lautaya", icon: <FiCornerUpLeft className="inline mr-1" /> },
};
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const day = (d) => (d ? dayjs(d).format("DD-MM-YYYY") : "");

export function useAdvance(memberId, open = true) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    if (!memberId) return setData(null);
    try { setData(await api.get(`/members/${memberId}/advance`)); } catch { setData(null); }
  }, [memberId]);
  useEffect(() => { if (open) load(); }, [load, open]);
  return { data, reload: load };
}

export default function AdvanceModal({ open, member, onClose, onChanged, startWith = "add" }) {
  const { message } = App.useApp();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const { data, reload } = useAdvance(member?.id, open);
  const [mode, setMode] = useState(startWith); // add | refund | history
  const [amount, setAmount] = useState(null);
  const [method, setMethod] = useState("cash");
  const [date, setDate] = useState(dayjs());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setMode(startWith); setAmount(null); setMethod("cash"); setDate(dayjs()); setReference(""); setNote(""); } }, [open, startWith]);

  const save = async () => {
    if (!(amount > 0)) return message.error("Rakam daalein");
    if (mode === "add" && method !== "cash" && !reference.trim()) return message.error("Reference / UTR number daalein");
    setBusy(true);
    try {
      const body = { amount, method, paymentDate: date.format("YYYY-MM-DD"), reference: reference.trim(), note: note.trim() };
      const r = await api.post(`/members/${member.id}/advance`, mode === "refund" ? { ...body, action: "refund" } : body);
      message.success(mode === "refund" ? `${inr(amount)} lautaya — advance ab ${inr(r.balance)}` : `${inr(amount)} advance jama — kul advance ${inr(r.balance)}`);
      setAmount(null); setReference(""); setNote("");
      await reload(); onChanged?.(r.balance);
      setMode("history");
    } catch (e) { message.error(e.message); } finally { setBusy(false); }
  };
  const cancelEntry = async (id) => {
    try {
      const r = await api.del(`/advances/${id}`);
      message.success("Entry cancel ho gayi"); await reload(); onChanged?.(r.balance);
    } catch (e) { message.error(e.message, 6); }
  };

  const bal = data?.balance ?? 0;
  const lim = data?.limit?.limit != null ? data.limit : null; // fixed rakam: advance only up to its room
  const overRoom = mode === "add" && lim && amount > lim.advanceRoom;
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={720} destroyOnHidden
      title={<div><div className="text-base font-semibold">Advance (अग्रिम) — {member?.displayName}</div><div className="text-xs font-normal text-gray-500">{member?.registrationNumber}</div></div>}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 rounded-xl bg-emerald-50 px-4 py-3 sm:col-span-1">
          <div className="text-xs font-semibold text-emerald-700">Abhi advance</div>
          <div className="text-2xl font-extrabold text-emerald-700">{data ? inr(bal) : "…"}</div>
        </div>
        <div className="rounded-xl bg-gray-50 px-4 py-3"><div className="text-xs text-gray-500">Kul jama</div><div className="font-bold">{inr(data?.totals?.deposited)}</div></div>
        <div className="rounded-xl bg-gray-50 px-4 py-3"><div className="text-xs text-gray-500">Closing mein lage</div><div className="font-bold">{inr(data?.totals?.used)}</div></div>
        <div className="rounded-xl bg-gray-50 px-4 py-3"><div className="text-xs text-gray-500">Lautaya</div><div className="font-bold">{inr(data?.totals?.refunded)}</div></div>
      </div>

      {lim ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          <span>Fixed rakam <b>{inr(lim.limit)}</b> · closings mein bhara {inr(lim.paid)} · advance {inr(lim.advance)}</span>
          <span className="ml-auto font-semibold">{lim.advanceRoom > 0 ? `Aur advance le sakte: ${inr(lim.advanceRoom)}` : "Seema poori — aur advance nahi"}</span>
          {mode === "add" && lim.advanceRoom > 0 ? <Button size="small" onClick={() => setAmount(lim.advanceRoom)}>{inr(lim.advanceRoom)} bharein</Button> : null}
        </div>
      ) : null}

      <Segmented block value={mode} onChange={setMode} className="mb-3"
        options={[{ value: "add", label: "Advance jama karein" }, ...(isAdmin ? [{ value: "refund", label: "Wapas dein" }] : []), { value: "history", label: `Hisaab (${data?.entries?.length ?? 0})` }]} />

      {mode !== "history" ? (
        <div className="space-y-3 rounded-xl border border-gray-200 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Rakam (₹)</span>
              <InputNumber className="!w-full" size="large" min={1} precision={0} value={amount} onChange={setAmount} placeholder="jaise 1000" /></label>
            <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Kaise</span>
              <Select className="w-full" size="large" value={method} onChange={setMethod} options={METHODS} /></label>
            <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Tareekh</span>
              <DatePicker className="w-full" size="large" value={date} onChange={(v) => setDate(v || dayjs())} format="DD-MM-YYYY" allowClear={false} /></label>
          </div>
          {method !== "cash" ? <Input size="large" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / reference / cheque no." /> : null}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={300} />
          {mode === "refund" && amount > bal ? <div className="text-xs text-red-600">Advance mein sirf {inr(bal)} hai</div> : null}
          {overRoom ? <div className="text-xs text-red-600">Fixed rakam {inr(lim.limit)} hai — sirf {inr(lim.advanceRoom)} advance le sakte hain</div> : null}
          <div className="flex justify-end">
            <Button type="primary" size="large" icon={mode === "refund" ? <FiRotateCcw /> : <FiPlus />} loading={busy} onClick={save}
              disabled={!(amount > 0) || (mode === "refund" && amount > bal) || overRoom} style={mode === "refund" ? undefined : { background: "#059669" }}>
              {mode === "refund" ? "Member ko wapas dein" : "Advance jama karein"}
            </Button>
          </div>
          <div className="text-xs text-gray-500">Closing ka payment lete waqt &quot;Advance se kaatein&quot; chunne par yahi rakam pehle lagegi.</div>
        </div>
      ) : (
        <Table size="small" rowKey="id" dataSource={data?.entries || []} pagination={{ pageSize: 8, hideOnSinglePage: true }}
          columns={[
            { title: "Tareekh", dataIndex: "paymentDate", width: 100, render: day },
            { title: "Kya", dataIndex: "kind", width: 160, render: (k, r) => <Tag color={r.status === "reversed" ? "default" : KIND[k]?.color}>{KIND[k]?.icon}{KIND[k]?.label || k}</Tag> },
            { title: "Rakam", dataIndex: "amount", width: 100, render: (a, r) => <span className={`font-semibold ${r.status === "reversed" ? "line-through text-gray-400" : r.kind === "deposit" || r.kind === "return" ? "text-emerald-700" : "text-gray-800"}`}>{r.kind === "deposit" || r.kind === "return" ? "+" : "−"}{inr(a)}</span> },
            { title: "Vivran", render: (_, r) => (
              <div className="text-xs text-gray-600">
                {r.kind === "use" && r.closingName ? `Closing: ${r.closingName}` : r.method !== "advance" ? r.method.toUpperCase() : ""}
                {r.reference ? ` · ${r.reference}` : ""}{r.note && r.kind !== "use" ? ` · ${r.note}` : ""}
                <div className="text-gray-400">{r.createdByName}{r.status === "reversed" ? " · cancel" : ""}</div>
              </div>
            ) },
            { title: "", width: 50, render: (_, r) => isAdmin && r.status === "completed" && ["deposit", "refund"].includes(r.kind) ? (
              <Popconfirm title="Ye entry cancel karein?" description="Galat entry ho tabhi." okText="Haan" cancelText="Nahi" onConfirm={() => cancelEntry(r.id)}>
                <Tooltip title="Galat entry cancel"><Button size="small" type="text" danger icon={<FiSlash />} /></Tooltip>
              </Popconfirm>
            ) : null },
          ]} />
      )}
    </Modal>
  );
}
