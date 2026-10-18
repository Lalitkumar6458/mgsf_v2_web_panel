// Gupshup WhatsApp API (https://docs.gupshup.io). Two calls:
//   sendTemplate  approved template (+ PDF in the document header) — works any time
//   sendText      plain text reply — only within 24 h after the member last wrote to us
// Both answer { status: "submitted", messageId }. Delivery / read / failure arrive later on the
// trust's callback URL (see services/whatsapp.js → handleCallback).
const BASE = "https://api.gupshup.io/wa/api/v1";

async function post(path, cfg, fields) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  let res, text = "";
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { apikey: cfg.apiKey, "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: form,
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, error: `Gupshup tak nahi pahunch paye: ${e.message}` };
  }
  let j = {};
  try { j = JSON.parse(text); } catch { /* Gupshup sometimes answers text/html */ }
  if (res.ok && j.messageId && j.status !== "error") return { ok: true, messageId: j.messageId, status: j.status || "submitted" };
  const msg = j.message || j.error?.message || j.reason || text.slice(0, 200) || `HTTP ${res.status}`;
  return { ok: false, error: `Gupshup: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`, status: res.status };
}

/**
 * cfg: { apiKey, source, appName }
 * media: { type: "document", link, filename } | null
 */
export function sendTemplate(cfg, { to, templateId, params, media }) {
  return post("/template/msg", cfg, {
    channel: "whatsapp",
    source: cfg.source,
    destination: to,
    "src.name": cfg.appName,
    template: { id: templateId, params },
    message: media?.link ? { type: media.type || "document", [media.type || "document"]: { link: media.link, ...(media.filename ? { filename: media.filename } : {}) } } : undefined,
  });
}

export function sendText(cfg, { to, text }) {
  return post("/msg", cfg, {
    channel: "whatsapp",
    source: cfg.source,
    destination: to,
    "src.name": cfg.appName,
    message: { type: "text", text },
  });
}
