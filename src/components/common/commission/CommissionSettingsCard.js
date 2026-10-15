"use client";
// Agent commission settings, used inside the Add / Edit agent forms.
// Form field: `commission` = { enabled, joinFees: { enabled, type, value }, closing: { … } }
import { Card, Form, InputNumber, Segmented, Switch, Tag } from "antd";
import { FiPercent } from "react-icons/fi";
import { COMMISSION_TYPE, rateLabel } from "@/lib/commission";

function RuleRow({ name, title, hint, form, disabled }) {
  const on = Form.useWatch(["commission", name, "enabled"], form);
  const type = Form.useWatch(["commission", name, "type"], form);
  const value = Form.useWatch(["commission", name, "value"], form);
  const off = disabled || on === false;
  return (
    <div className={`rounded-lg border p-3 transition ${off ? "border-gray-200 bg-gray-50" : "border-indigo-200 bg-indigo-50/40"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-gray-800">{title}</div>
          <div className="text-xs text-gray-500">{hint}</div>
        </div>
        <Form.Item name={["commission", name, "enabled"]} valuePropName="checked" noStyle>
          <Switch disabled={disabled} />
        </Form.Item>
      </div>
      {!off && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Form.Item name={["commission", name, "type"]} label="Type" className="!mb-0">
            <Segmented options={[{ label: "Percent %", value: COMMISSION_TYPE.PERCENTAGE }, { label: "Fixed ₹", value: COMMISSION_TYPE.FIXED }]} />
          </Form.Item>
          <Form.Item
            name={["commission", name, "value"]}
            label={type === COMMISSION_TYPE.FIXED ? "Amount (₹)" : "Percent"}
            className="!mb-0"
            rules={[{ required: true, message: "Enter a value" },
              { validator: (_, v) => (type !== COMMISSION_TYPE.FIXED && Number(v) > 100 ? Promise.reject(new Error("Max 100%")) : Promise.resolve()) }]}
          >
            <InputNumber min={0} max={type === COMMISSION_TYPE.FIXED ? 100000 : 100} step={type === COMMISSION_TYPE.FIXED ? 10 : 1}
              addonAfter={type === COMMISSION_TYPE.FIXED ? "₹" : "%"} style={{ width: 150 }} />
          </Form.Item>
          <Tag color="purple" className="!mb-1">
            {type === COMMISSION_TYPE.FIXED
              ? `${rateLabel(type, value)} per ${name === "closing" ? "closing (full payment)" : "member (full join fee)"}`
              : `${rateLabel(type, value)} of every payment`}
          </Tag>
        </div>
      )}
    </div>
  );
}

export default function CommissionSettingsCard({ form }) {
  const enabled = Form.useWatch(["commission", "enabled"], form);
  return (
    <Card
      className="shadow-sm"
      title={<span className="flex items-center gap-2"><FiPercent /> Agent Commission</span>}
      extra={
        <Form.Item name={["commission", "enabled"]} valuePropName="checked" noStyle>
          <Switch checkedChildren="Allowed" unCheckedChildren="Off" />
        </Form.Item>
      }
    >
      {!enabled ? (
        <div className="text-sm text-gray-500">Is agent ko commission nahi milega. Switch on karke join fees / closing payment par commission set karein.</div>
      ) : (
        <div className="space-y-3">
          <RuleRow form={form} name="joinFees" title="Join fees (नामांकन शुल्क)"
            hint="Jab bhi is agent ke member ki join fees jama hogi" />
          <RuleRow form={form} name="closing" title="Closing payment (विवाह सहयोग)"
            hint="Jab bhi is agent ka member kisi closing ka paisa dega" />
          <div className="text-[11px] text-gray-500 leading-relaxed">
            Commission us waqt ki rate se history mein judta hai. Rate badalne se purani entries nahi badalti.
            Payment reverse / delete hone par commission bhi cancel ho jaata hai.
          </div>
        </div>
      )}
    </Card>
  );
}
