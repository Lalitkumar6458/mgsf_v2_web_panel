"use client";
// Fixed rakam (seema) — UI pieces. Shown only when feature-control has "fixedLimit" on.
//   <FixedLimitField />      antd Form.Item (name "fixedLimit") for Add / Edit member
//   <FixedLimitTag … />      "Fixed ₹15,200 · ₹3,000 bhara · ₹12,200 baki" chip
//   <FixedLimitModal … />    Members page → select many → set / remove the limit (+ fill advance)
import { useMemo, useState } from "react";
import { App, Button, Checkbox, Col, DatePicker, Form, InputNumber, Modal, Row, Table, Tag, Tooltip } from "antd";
import { FiLock, FiUnlock, FiCheckCircle } from "react-icons/fi";
import dayjs from "dayjs";
import { api } from "@/lib/client/api";
import { useFeature } from "@/lib/AuthProvider";

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
export const useFixedLimitOn = () => useFeature()("fixedLimit");

export function FixedLimitField({ payAmount }) {
  const on = useFixedLimitOn();
  if (!on) return null;
  return (
    <Col xs={24} sm={12} lg={8}>
      <Form.Item name="fixedLimit" label="Fixed rakam (kul seema)"
        extra={<span className="text-xs text-gray-500">Khaali = koi seema nahi. Utna bharne ke baad aage koi closing baki nahi aayegi{payAmount ? ` (kist ₹${payAmount})` : ""}.</span>}>
        <InputNumber className="!w-full" min={1} precision={0} placeholder="jaise 15200" prefix="₹" />
      </Form.Item>
    </Col>
  );
}

/** limit = fixed rakam, paid = kul bhara (closings). Nothing when there is no limit. */
export function FixedLimitTag({ limit, paid = 0, className = "" }) {
  if (limit == null) return null;
  const left = Math.max(limit - paid, 0);
  return (
    <Tooltip title={left ? `Fixed rakam ${inr(limit)} — ${inr(paid)} bhar chuke, ${inr(left)} aur bharna hai; uske baad koi closing baki nahi` : `Fixed rakam ${inr(limit)} poori bhar di — aage koi closing baki nahi`}>
      <Tag color={left ? "geekblue" : "green"} className={`!m-0 ${className}`} bordered={false}>
        {left ? <FiLock className="mr-1 inline" /> : <FiCheckCircle className="mr-1 inline" />}
        Fixed {inr(limit)}{left ? ` · ${inr(left)} baki` : " · poora"}
      </Tag>
    </Tooltip>
  );
}

/** members: rows from the members list ({ id, displayName, registrationNumber, payAmount, fixedLimit, paidTotal, openAmount }) */
export function FixedLimitModal({ open, programId, members = [], onClose, onDone }) {
  const { message } = App.useApp();
  const advanceOn = useFeature()("advancePayment");
  const [amount, setAmount] = useState(null);
  const [remove, setRemove] = useState(false);
  const [fillAdvance, setFillAdvance] = useState(false);
  const [date, setDate] = useState(dayjs());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const reset = () => { setAmount(null); setRemove(false); setFillAdvance(false); setDate(dayjs()); setResult(null); };
  const close = () => { reset(); onClose?.(); };

  const rows = useMemo(() => members.map((m) => {
    const paid = m.paidTotal || 0;
    const left = amount ? Math.max(amount - paid, 0) : null;
    return { ...m, paid, left, over: amount ? paid > amount : false };
  }), [members, amount]);
  const overCount = rows.filter((r) => r.over).length;

  const save = async () => {
    if (!remove && !(amount > 0)) return message.error("Fixed rakam daalein");
    setBusy(true);
    try {
      const r = await api.post(`/programs/${programId}/fixed-limit`, {
        memberIds: members.map((m) => m.id), fixedLimit: remove ? null : amount,
        advance: !remove && fillAdvance ? { method: "cash", paymentDate: date.format("YYYY-MM-DD") } : null,
      });
      setResult(r);
      message.success(remove ? `${r.count} sadasyon ki seema hata di` : `${r.count} sadasyon ki fixed rakam ${inr(r.fixedLimit)} set`);
      onDone?.(r);
    } catch (e) { message.error(e.message, 6); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onCancel={close} width={760} destroyOnHidden
      title={<div><div className="text-base font-semibold">Fixed rakam (kul seema) — {members.length} sadasya</div>
        <div className="text-xs font-normal text-gray-500">Jitni rakam set karenge, closing payment utne tak hi banega. Utna bhar diya to aage kuch baki nahi aayega.</div></div>}
      footer={result ? <Button type="primary" onClick={close}>Theek hai</Button> : [
        <Button key="c" onClick={close}>Radd</Button>,
        <Button key="s" type="primary" loading={busy} onClick={save} danger={remove} icon={remove ? <FiUnlock /> : <FiLock />}
          disabled={!remove && !(amount > 0)}>
          {remove ? "Seema hatayein" : `${inr(amount)} set karein${fillAdvance ? " + advance jama" : ""}`}
        </Button>,
      ]}>
      {result ? (
        <Table size="small" rowKey="id" pagination={{ pageSize: 8, hideOnSinglePage: true }} dataSource={result.members}
          summary={() => result.advanceTotal ? <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={4}><b>Kul advance jama: {inr(result.advanceTotal)}</b> (cash)</Table.Summary.Cell></Table.Summary.Row> : null}
          columns={[
            { title: "Sadasya", render: (_, r) => <div><div className="font-medium">{r.displayName}</div><div className="text-xs text-gray-400">{r.registrationNumber}</div></div> },
            { title: "Seema", render: (_, r) => r.limit == null ? <span className="text-gray-400">nahi</span> : <FixedLimitTag limit={r.limit} paid={r.paid} /> },
            { title: "Abhi baki (closings)", align: "right", render: (_, r) => inr(r.owed) },
            { title: "Advance", align: "right", render: (_, r) => <span>{inr(r.advance)}{r.advanceAdded ? <span className="ml-1 text-xs text-emerald-600">(+{inr(r.advanceAdded)})</span> : null}</span> },
          ]} />
      ) : (
        <>
          <Row gutter={12} className="mb-3">
            <Col xs={24} sm={12}>
              <div className="mb-1 text-xs font-semibold text-gray-600">Har sadasya ki kul fixed rakam (₹)</div>
              <InputNumber size="large" className="!w-full" min={1} precision={0} value={amount} onChange={setAmount} disabled={remove} placeholder="jaise 15200" prefix="₹" autoFocus />
            </Col>
            <Col xs={24} sm={12} className="flex items-end">
              <Checkbox checked={remove} onChange={(e) => setRemove(e.target.checked)}>Seema hatayein (pehle jaisa — har closing poori)</Checkbox>
            </Col>
          </Row>
          {advanceOn && !remove ? (
            <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <Checkbox checked={fillAdvance} onChange={(e) => setFillAdvance(e.target.checked)}>
                <b>Saath mein baki rakam advance mein jama karein (cash)</b>
              </Checkbox>
              <div className="mt-1 text-xs text-emerald-800">Har sadasya ka (fixed rakam − ab tak bhara − pehle ka advance) advance mein jama hoga. Closing aate hi &quot;Advance se kaatein&quot; se kat jaayega.</div>
              {fillAdvance ? <div className="mt-2 flex items-center gap-2 text-xs"><span>Tareekh</span><DatePicker size="small" value={date} onChange={(v) => setDate(v || dayjs())} format="DD-MM-YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), "day")} /></div> : null}
            </div>
          ) : null}
          {overCount ? <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{overCount} sadasya is rakam se zyada pehle hi bhar chuke hain — unka bhara paisa waisa hi rahega, aage kuch baki nahi aayega.</div> : null}
          <Table size="small" rowKey="id" pagination={{ pageSize: 6, hideOnSinglePage: true }} dataSource={rows}
            columns={[
              { title: "Sadasya", render: (_, r) => <div><div className="font-medium">{r.displayName}</div><div className="text-xs text-gray-400">{r.registrationNumber} · kist ₹{r.payAmount ?? 0}</div></div> },
              { title: "Abhi seema", render: (_, r) => r.fixedLimit == null ? <span className="text-gray-400">—</span> : <FixedLimitTag limit={r.fixedLimit} paid={r.paid} /> },
              { title: "Ab tak bhara", align: "right", render: (_, r) => inr(r.paid) },
              { title: remove ? "" : "Aur bharna (kul)", align: "right", render: (_, r) => remove || r.left == null ? "" : <b className={r.over ? "text-amber-600" : "text-blue-700"}>{inr(r.left)}</b> },
            ]} />
        </>
      )}
    </Modal>
  );
}
