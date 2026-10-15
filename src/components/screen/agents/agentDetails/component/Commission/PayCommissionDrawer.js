"use client";
// Pay the agent his commission: all pending, up to an amount (oldest first) or the rows chosen in the table.
import { useEffect, useState } from "react";
import { App, Alert, Button, DatePicker, Drawer, Form, Input, InputNumber, Segmented, Select } from "antd";
import { FiCheckCircle } from "react-icons/fi";
import dayjs from "dayjs";
import { api } from "@/lib/client/api";
import { money } from "@/lib/commission";

export default function PayCommissionDrawer({ open, onClose, agent, summary, selected = [], filters = {}, programName, onPaid }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const mode = Form.useWatch("mode", form);
  const upto = Form.useWatch("upto", form);
  const selectedSum = Math.round(selected.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100;
  const pending = Number(summary?.pending || 0);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({ mode: selected.length ? "selected" : "all", payoutDate: dayjs(), paymentMode: "cash" });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const amountText = mode === "selected" ? money(selectedSum) : mode === "upto" ? `up to ${money(upto || 0)}` : money(pending);
  const canPay = mode === "selected" ? selectedSum > 0 : mode === "upto" ? Number(upto) > 0 : pending > 0;

  const submit = async (v) => {
    setBusy(true);
    try {
      const body = {
        mode: v.mode,
        commissionIds: v.mode === "selected" ? selected.map((r) => r.id) : undefined,
        upto: v.mode === "upto" ? v.upto : undefined,
        filters: v.mode === "selected" ? undefined : { programId: filters.programId },
        paymentMode: v.paymentMode,
        reference: v.reference || "",
        note: v.note || "",
        payoutDate: v.payoutDate ? v.payoutDate.format("YYYY-MM-DD") : undefined,
      };
      const r = await api.post(`/agents/${agent.id}/commission-payouts`, body);
      message.success(`${money(r.payout.amount)} paid to ${agent.displayName} · ${r.payout.payoutNumber} (${r.entries} entries)`);
      onPaid?.(r);
      onClose();
    } catch (e) {
      message.error(e.message || "Payout failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={`Pay commission · ${agent?.displayName || ""}`}
      open={open} onClose={onClose} destroyOnHidden
      width={typeof window !== "undefined" ? Math.min(480, window.innerWidth) : 480}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-gray-600">Paying <b className="text-gray-900">{amountText}</b></div>
          <Button type="primary" icon={<FiCheckCircle />} loading={busy} disabled={!canPay} onClick={() => form.submit()}>Confirm payment</Button>
        </div>
      }
    >
      <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 mb-4">
        <div className="text-xs uppercase tracking-wide text-indigo-700 font-semibold">Balance to pay{programName ? ` · ${programName}` : ""}</div>
        <div className="text-2xl font-bold text-indigo-900 mt-0.5">{money(pending)}</div>
        <div className="text-xs text-indigo-700/80">{summary?.pendingCount || 0} pending entries{summary?.oldestPending ? ` · oldest ${dayjs(summary.oldestPending).format("DD MMM YYYY")}` : ""}</div>
      </div>
      {pending < 0 && <Alert className="!mb-4" type="warning" showIcon message="Balance is negative — some paid commission was reversed. It will be taken off the next payout." />}
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item name="mode" label="What to pay">
          <Segmented block options={[
            { label: "All pending", value: "all" },
            { label: "Up to amount", value: "upto" },
            { label: `Selected (${selected.length})`, value: "selected", disabled: !selected.length },
          ]} />
        </Form.Item>
        {mode === "upto" && (
          <Form.Item name="upto" label="Amount (oldest entries first, whole entries only)" rules={[{ required: true, message: "Enter amount" }]}>
            <InputNumber min={1} max={Math.max(pending, 1)} prefix="₹" className="!w-full" />
          </Form.Item>
        )}
        {mode === "selected" && <div className="text-sm text-gray-600 -mt-2 mb-4">{selected.length} entries chosen in the table · {money(selectedSum)}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Form.Item name="paymentMode" label="Paid by">
            <Select options={[
              { value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }, { value: "bank", label: "Bank transfer" },
              { value: "cheque", label: "Cheque" }, { value: "other", label: "Other" },
            ]} />
          </Form.Item>
          <Form.Item name="payoutDate" label="Date">
            <DatePicker className="w-full" format="DD-MM-YYYY" />
          </Form.Item>
        </div>
        <Form.Item name="reference" label="Reference / UTR / cheque no.">
          <Input maxLength={60} />
        </Form.Item>
        <Form.Item name="note" label="Note">
          <Input.TextArea rows={2} maxLength={300} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
