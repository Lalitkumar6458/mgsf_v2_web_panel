"use client";
// Payments → App payment requests. A member / agent paid on the trust's UPI QR / bank and sent UTR +
// screenshot from the app. Check the money came in, then "Sweekar karke jama karein" (payment is written
// like any other: dues paid, receipt, push + WhatsApp) or "Asweekar" with a reason the person sees.
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Alert, Button, Checkbox, DatePicker, Drawer, Empty, Image, Input, InputNumber, Modal, Segmented, Spin, Table, Tag, Tooltip } from "antd";
import { FiCheckCircle, FiCopy, FiInbox, FiRefreshCw, FiSearch, FiSmartphone, FiUser, FiXCircle, FiAlertTriangle } from "react-icons/fi";
import dayjs from "dayjs";
import { api } from "@/lib/client/api";
import { useCan, useFeature } from "@/lib/AuthProvider";

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const day = (d) => (d ? dayjs(d).format("DD-MM-YYYY") : "—");
const when = (d) => (d ? dayjs(d).format("DD MMM, hh:mm A") : "—");
const STATUS = {
  pending: { color: "gold", label: "Jaanch baki" },
  approved: { color: "green", label: "Sweekar · jama" },
  rejected: { color: "red", label: "Asweekar" },
  cancelled: { color: "default", label: "Radd (bhejne wale ne)" },
};
const METHOD = { upi: "UPI", bank: "Bank", online: "Online" };
const REASONS = ["Bank / UPI mein paisa nahi aaya", "UTR galat hai", "Rakam alag hai — sahi rakam ke saath dobara bhejein", "Screenshot saaf nahi hai", "Ye bhugtan pehle hi jama ho chuka hai"];

export default function PaymentRequestsPage() {
  const { message } = App.useApp();
  const can = useCan();
  const feature = useFeature();
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [data, setData] = useState({ requests: [], counts: {}, total: 0 });
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.get(`/payment-requests?status=${status}&q=${encodeURIComponent(q.trim())}`)); }
    catch (e) { message.error(e.message); } finally { setLoading(false); }
  }, [status, q, message]);
  useEffect(() => { const t = setTimeout(load, q ? 350 : 0); return () => clearTimeout(t); }, [load, q]);

  if (!feature("paymentRequests")) return <Empty className="mt-20" description="App payment requests is panel mein chalu nahi hai" />;
  if (!can("payments")) return <Empty className="mt-20" description="Aapko payments dekhne ki permission nahi hai" />;
  const c = data.counts || {};

  const columns = [
    { title: "Request", width: 150, render: (_, r) => <div><div className="font-semibold text-gray-900">{r.requestNo}</div><div className="text-xs text-gray-400">{when(r.createdAt)}</div></div> },
    { title: "Kisne bheja", render: (_, r) => (
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${r.requestedByRole === "agent" ? "bg-violet-50 text-violet-600" : "bg-blue-50 text-blue-600"}`}>{r.requestedByRole === "agent" ? <FiUser /> : <FiSmartphone />}</span>
        <div className="min-w-0"><div className="truncate font-medium">{r.requestedByName || "—"}</div><div className="text-xs text-gray-400">{r.requestedByRole === "agent" ? "Agent" : "Sadasya"}</div></div>
      </div>) },
    { title: "Kiske liye", render: (_, r) => <div className="text-sm">{(r.items || []).map((i) => <div key={i.memberId} className="truncate">{i.name} <span className="text-xs text-gray-400">{i.regNo}</span></div>)}</div> },
    { title: "Rakam", align: "right", width: 120, render: (_, r) => (
      <div><div className="font-bold tabular-nums">{inr(r.amount)}</div>{r.expectedAmount && r.expectedAmount !== r.amount ? <div className="text-[11px] text-amber-600">chuna {inr(r.expectedAmount)}</div> : null}</div>) },
    { title: "UTR", width: 170, render: (_, r) => <div><div className="font-mono text-sm">{r.reference}</div><div className="text-xs text-gray-400">{METHOD[r.method] || r.method} · {day(r.paymentDate)}</div></div> },
    { title: "Screenshot", width: 90, render: (_, r) => r.screenshotUrl ? <Image src={r.screenshotUrl} width={44} height={44} style={{ objectFit: "cover", borderRadius: 8 }} onClick={(e) => e.stopPropagation()} /> : <span className="text-xs text-gray-300">nahi</span> },
    { title: "Status", width: 150, render: (_, r) => <div><Tag color={STATUS[r.status]?.color} className="!m-0">{STATUS[r.status]?.label || r.status}</Tag>{r.reviewedByName && r.status !== "pending" ? <div className="mt-0.5 text-[11px] text-gray-400">{r.reviewedByName} · {when(r.reviewedAt)}</div> : null}</div> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 flex items-center gap-2 text-xl font-bold text-gray-900"><FiInbox /> App payment requests</h1>
          <div className="text-sm text-gray-500">Sadasya / agent ne trust ke QR ya bank mein bhugtan karke app se UTR bheja hai. Paisa aaya ho to sweekar karein — closing turant jama ho jaayegi.</div>
        </div>
        <Button icon={<FiRefreshCw className={loading ? "animate-spin" : ""} />} onClick={load}>Reload</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={status} onChange={setStatus} options={[
          { value: "pending", label: <span>Jaanch baki {c.pending ? <b className="ml-1 rounded-full bg-red-500 px-1.5 text-xs text-white">{c.pending}</b> : null}</span> },
          { value: "approved", label: `Sweekar (${c.approved || 0})` },
          { value: "rejected", label: `Asweekar (${c.rejected || 0})` },
          { value: "cancelled", label: `Radd (${c.cancelled || 0})` },
          { value: "all", label: "Sab" },
        ]} />
        <Input allowClear prefix={<FiSearch className="text-gray-400" />} placeholder="UTR, naam, reg. no., request no." value={q} onChange={(e) => setQ(e.target.value)} className="!w-72" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <Table rowKey="id" size="middle" loading={loading} dataSource={data.requests} columns={columns} scroll={{ x: 980 }}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          onRow={(r) => ({ onClick: () => setOpenId(r.id), style: { cursor: "pointer" } })}
          locale={{ emptyText: <Empty description={status === "pending" ? "Koi request jaanch ke liye baki nahi 🎉" : "Kuch nahi"} /> }} />
      </div>

      <RequestDrawer id={openId} onClose={() => setOpenId(null)} onDone={() => { setOpenId(null); load(); window.dispatchEvent(new Event("mgsf:payreq")); }} />
    </div>
  );
}

function RequestDrawer({ id, onClose, onDone }) {
  const { message, modal } = App.useApp();
  const advanceOn = useFeature()("advancePayment");
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState({});      // memberId → Set(dueId)
  const [fee, setFee] = useState({});      // memberId → ₹ joining fee
  const [amount, setAmount] = useState(0);
  const [ref, setRef] = useState("");
  const [payDay, setPayDay] = useState(dayjs());
  const [toAdvance, setToAdvance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!id) { setD(null); setResult(null); return; }
    setLoading(true);
    api.get(`/payment-requests/${id}`).then((r) => {
      setD(r);
      setSel(Object.fromEntries(r.members.map((m) => [m.id, new Set(m.dues.filter((x) => x.requested && x.remaining > 0).map((x) => x.id))])));
      setFee(Object.fromEntries(r.members.map((m) => [m.id, Math.min(m.requestedJoinFee || 0, m.joinFeeDue)])));
      setAmount(r.request.amount); setRef(r.request.reference); setPayDay(dayjs(r.request.paymentDate)); setToAdvance(false); setResult(null);
    }).catch((e) => message.error(e.message)).finally(() => setLoading(false));
  }, [id, message]);

  const chosen = useMemo(() => {
    if (!d) return 0;
    return d.members.reduce((a, m) => a + m.dues.filter((x) => sel[m.id]?.has(x.id)).reduce((s, x) => s + x.remaining, 0) + (fee[m.id] || 0), 0);
  }, [d, sel, fee]);
  const extra = Math.max((amount || 0) - chosen, 0);
  const short = Math.max(chosen - (amount || 0), 0);
  const r = d?.request;
  const pending = r?.status === "pending";

  const toggle = (mid, did, on) => setSel((s) => { const n = new Set(s[mid]); on ? n.add(did) : n.delete(did); return { ...s, [mid]: n }; });

  const approve = () => {
    if (!(amount > 0)) return message.error("Kitni rakam mili, daalein");
    if (!ref.trim()) return message.error("UTR daalein");
    if (extra > 0 && !toAdvance) return message.error(`${inr(extra)} zyada hai — closing / fee chunein ya "bacha paisa advance mein" tick karein`);
    modal.confirm({
      title: `${inr(amount)} jama karein?`,
      content: <div className="text-sm">Chuni hui closing / fee mein {inr(Math.min(amount, chosen))}{extra ? `, advance mein ${inr(extra)}` : ""}{short ? ` (${inr(short)} kam — sabse purani closing pehle, aakhri wali aadhi)` : ""}. UTR {ref}. Ye payment history mein dikhega aur sadasya ko rasid jayegi.</div>,
      okText: "Haan, jama karein", cancelText: "Nahi",
      onOk: async () => {
        setBusy(true);
        try {
          const res = await api.post(`/payment-requests/${id}`, {
            action: "approve", amount, reference: ref.trim(), paymentDate: payDay.format("YYYY-MM-DD"), extraToAdvance: extra > 0 && toAdvance,
            items: d.members.map((m) => ({ memberId: m.id, dueIds: [...(sel[m.id] || [])], joinFee: fee[m.id] || 0 })),
          });
          setResult(res);
          message.success(`${r.requestNo} jama ho gaya`);
        } catch (e) { message.error(e.message, 6); } finally { setBusy(false); }
      },
    });
  };
  const reject = async () => {
    if (reason.trim().length < 3) return message.error("Kaaran likhein");
    setBusy(true);
    try {
      await api.post(`/payment-requests/${id}`, { action: "reject", reason: reason.trim() });
      message.success("Asweekar kiya — bhejne wale ko app mein kaaran dikhega");
      setRejectOpen(false); setReason(""); onDone();
    } catch (e) { message.error(e.message); } finally { setBusy(false); }
  };
  const copy = (v) => { navigator.clipboard?.writeText(v); message.success("Copy ho gaya"); };

  return (
    <Drawer open={!!id} onClose={result ? onDone : onClose} width={820} destroyOnHidden
      title={r ? <div className="flex items-center gap-2"><span>{r.requestNo}</span><Tag color={STATUS[result ? "approved" : r.status]?.color}>{STATUS[result ? "approved" : r.status]?.label}</Tag></div> : "Request"}
      footer={pending && !result ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto text-sm">
            <span className="text-gray-500">Chuna:</span> <b>{inr(chosen)}</b> · <span className="text-gray-500">Mila:</span> <b>{inr(amount)}</b>
            {extra ? <span className="ml-2 text-amber-600">+{inr(extra)} zyada</span> : short ? <span className="ml-2 text-amber-600">{inr(short)} kam</span> : <span className="ml-2 text-emerald-600">barabar ✓</span>}
          </div>
          <Button danger icon={<FiXCircle />} onClick={() => setRejectOpen(true)}>Asweekar</Button>
          <Button type="primary" icon={<FiCheckCircle />} loading={busy} onClick={approve} style={{ background: "#059669" }} disabled={!d || !!d.duplicate}>Sweekar karke jama karein</Button>
        </div>
      ) : result ? <Button type="primary" onClick={onDone}>Theek hai</Button> : null}>
      {loading || !d ? <div className="py-20 text-center"><Spin /></div> : result ? (
        <div className="py-6 text-center">
          <FiCheckCircle className="mx-auto text-5xl text-emerald-500" />
          <div className="mt-3 text-2xl font-black text-gray-900">{inr(result.receivedAmount)} jama</div>
          <div className="mt-1 text-sm text-gray-600">
            Closing {inr(result.closingAmount)}{result.joinFeeAmount ? ` · Join fee ${inr(result.joinFeeAmount)}` : ""}{result.advance ? ` · Advance ${inr(result.advance.amount)}` : ""}
          </div>
          <div className="mt-1 text-xs text-gray-400">{result.batches.map((b) => b.batchId).join(", ")} — sadasya ko app / WhatsApp par rasid chali gayi</div>
        </div>
      ) : (
        <div className="space-y-4">
          {d.duplicate && pending ? <Alert type="error" showIcon icon={<FiAlertTriangle />} message={d.duplicate} description="Ise asweekar karein." /> : null}
          {r.status === "rejected" ? <Alert type="error" showIcon message={`Asweekar: ${r.rejectReason}`} description={`${r.reviewedByName} · ${when(r.reviewedAt)}`} /> : null}
          {r.status === "approved" ? <Alert type="success" showIcon message={`Jama: ${inr(r.result?.receivedAmount ?? r.amount)}`} description={`${r.reviewedByName} · ${when(r.reviewedAt)} · ${(r.result?.batches || []).map((b) => b.batchId).join(", ")}`} /> : null}

          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-2 text-center">
              {r.screenshotUrl ? <Image src={r.screenshotUrl} style={{ maxHeight: 360, objectFit: "contain" }} /> : <div className="py-16 text-xs text-gray-400">Screenshot nahi bheja</div>}
            </div>
            <div className="space-y-2 text-sm">
              <Row k="Bheja" v={<>{r.requestedByName} <Tag className="!ml-1">{r.requestedByRole === "agent" ? "Agent" : "Sadasya"}</Tag> · {when(r.createdAt)}</>} />
              <Row k="Unke hisaab se" v={<><b>{inr(r.amount)}</b> · {METHOD[r.method] || r.method} · {day(r.paymentDate)}{r.expectedAmount !== r.amount ? <span className="ml-1 text-amber-600">(chuna tha {inr(r.expectedAmount)})</span> : null}</>} />
              <Row k="UTR" v={<span className="font-mono">{r.reference} <Tooltip title="Copy"><Button size="small" type="text" icon={<FiCopy />} onClick={() => copy(r.reference)} /></Tooltip></span>} />
              {r.note ? <Row k="Note" v={r.note} /> : null}
              {pending ? (
                <div className="mt-3 grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 sm:grid-cols-3">
                  <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Bank mein kitna aaya (₹)</span>
                    <InputNumber className="!w-full" min={1} precision={0} value={amount} onChange={(v) => setAmount(v || 0)} /></label>
                  <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">UTR</span>
                    <Input value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} /></label>
                  <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Bhugtan ki tareekh</span>
                    <DatePicker className="w-full" value={payDay} onChange={(v) => setPayDay(v || dayjs())} format="DD-MM-YYYY" allowClear={false} disabledDate={(x) => x.isAfter(dayjs(), "day")} /></label>
                  <div className="text-xs text-gray-500 sm:col-span-3">Bank / UPI app mein UTR aur rakam milaa kar dekhein. Rakam kam aayi ho to wahi daalein — sabse purani closing pehle jama hogi.</div>
                </div>
              ) : null}
            </div>
          </div>

          {d.members.map((m) => {
            const s = sel[m.id] || new Set();
            const open = m.dues.filter((x) => x.remaining > 0);
            return (
              <div key={m.id} className="overflow-hidden rounded-xl border border-gray-200">
                <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="min-w-0 flex-1"><b>{m.displayName}</b> <span className="text-xs text-gray-500">{m.registrationNumber} · {m.programName}{m.village ? ` · ${m.village}` : ""}{m.agentName ? ` · agent ${m.agentName}` : ""}</span></div>
                  {pending && open.length ? <Button size="small" type="link" onClick={() => setSel((x) => ({ ...x, [m.id]: s.size === open.length ? new Set() : new Set(open.map((y) => y.id)) }))}>{s.size === open.length ? "Sab hatayein" : "Sab baki chunein"}</Button> : null}
                </div>
                {m.dues.length ? m.dues.map((x) => (
                  <label key={x.id} className={`flex items-center gap-3 border-b border-gray-50 px-3 py-2 text-sm last:border-0 ${x.requested ? "bg-blue-50/40" : ""}`}>
                    <Checkbox disabled={!pending || x.remaining <= 0} checked={pending ? s.has(x.id) : x.requested} onChange={(e) => toggle(m.id, x.id, e.target.checked)} />
                    <div className="min-w-0 flex-1"><span className="font-medium">{x.closingName}</span> <span className="text-xs text-gray-400">{x.closingRegNo} · {day(x.closingDate)}{x.groupName ? ` · ${x.groupName}` : ""}</span>
                      {x.requested ? <Tag color="blue" className="!ml-2" bordered={false}>request mein</Tag> : null}</div>
                    {x.remaining <= 0 ? <Tag color="green" bordered={false}>pehle se jama</Tag> : <b className="tabular-nums">{inr(x.remaining)}</b>}
                  </label>
                )) : <div className="px-3 py-3 text-sm text-gray-400">Koi closing baki nahi</div>}
                {m.joinFeeDue > 0 || m.requestedJoinFee > 0 ? (
                  <div className="flex items-center gap-3 border-t border-gray-100 bg-amber-50/40 px-3 py-2 text-sm">
                    <Checkbox disabled={!pending || !m.joinFeeDue} checked={(fee[m.id] || 0) > 0} onChange={(e) => setFee((f) => ({ ...f, [m.id]: e.target.checked ? m.joinFeeDue : 0 }))} />
                    <span className="flex-1">Namankan shulk (join fee) <span className="text-xs text-gray-400">baki {inr(m.joinFeeDue)}</span></span>
                    {pending ? <InputNumber size="small" style={{ width: 110 }} min={0} max={m.joinFeeDue} precision={0} value={fee[m.id] || 0} onChange={(v) => setFee((f) => ({ ...f, [m.id]: v || 0 }))} /> : <b>{inr(m.requestedJoinFee)}</b>}
                  </div>
                ) : null}
              </div>
            );
          })}

          {pending && extra > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <b>{inr(extra)}</b> chuni hui closing / fee se zyada aaya hai.
              {advanceOn ? <Checkbox className="!ml-2" checked={toAdvance} onChange={(e) => setToAdvance(e.target.checked)}>Bacha paisa {d.members[0]?.displayName} ke advance mein daalein</Checkbox> : <span className="ml-1">Aur closing chunein ya rakam kam karein.</span>}
            </div>
          ) : null}
        </div>
      )}

      <Modal open={rejectOpen} onCancel={() => setRejectOpen(false)} title="Asweekar karne ka kaaran" okText="Asweekar karein" okButtonProps={{ danger: true, loading: busy }} onOk={reject} destroyOnHidden>
        <div className="mb-2 flex flex-wrap gap-1.5">{REASONS.map((x) => <Tag key={x} className="cursor-pointer" color={reason === x ? "red" : "default"} onClick={() => setReason(x)}>{x}</Tag>)}</div>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Ye kaaran bhejne wale ko app mein dikhega" />
      </Modal>
    </Drawer>
  );
}

function Row({ k, v }) {
  return <div className="flex gap-2"><span className="w-28 shrink-0 text-gray-500">{k}</span><span className="min-w-0 flex-1">{v}</span></div>;
}
