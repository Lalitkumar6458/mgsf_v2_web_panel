"use client";
// "WhatsApp par welcome + certificate bhejein" tick box for the add-member form and the accept dialog.
// Shown only when the trust has WhatsApp API (feature-control) and the join template is on
// (Settings → WhatsApp). Not ticked by default. Use inside an antd <Form>: field name "sendWhatsapp".
import { useEffect, useState } from "react";
import { Checkbox, Form } from "antd";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "@/lib/client/api";
import { useFeature } from "@/lib/AuthProvider";

let cache = null; // one check per page load
export function useWhatsAppJoin() {
  const feature = useFeature();
  const on = feature("whatsappApi");
  const [ready, setReady] = useState(cache?.ready || false);
  useEffect(() => {
    if (!on) { setReady(false); return; }
    if (cache) { setReady(cache.ready); return; }
    api.get("/whatsapp/status").then((r) => { cache = r; setReady(!!r.ready); }).catch(() => setReady(false));
  }, [on]);
  return on && ready;
}

export default function WhatsAppJoinTick({ name = "sendWhatsapp" }) {
  const ready = useWhatsAppJoin();
  if (!ready) return null;
  return (
    <Form.Item name={name} valuePropName="checked" initialValue={false} style={{ marginBottom: 8 }}>
      <Checkbox>
        <span className="inline-flex items-center gap-1.5">
          <FaWhatsapp className="text-[#25D366]" /> Member ko WhatsApp par welcome message + सदस्यता प्रमाण पत्र भेजें
        </span>
      </Checkbox>
    </Form.Item>
  );
}
