// Settings → WhatsApp (Gupshup). Stored on admins.extra.whatsapp. Plain module (tests + UI use it).
//
// Every trust has its own Gupshup app (API key, WhatsApp number, app name) and its own approved
// templates. For each of the 3 automatic messages the trust pastes:
//   templateId  the Gupshup template ID (Gupshup → Templates → copy ID)
//   body        the template text with {{1}} {{2}} … (only to show a preview and count the slots)
//   params      what goes in each {{n}}: text with variables, e.g. "{name}", "₹{pendingAmount}"
//   media       PDF in the template's document header: certificate / pending rasid / paid rasid
//
//   join     new member accepted          → सदस्यता प्रमाण पत्र
//   pending  baki payment (new closing / bulk reminder) → pending rasid
//   paid     payment received             → paid rasid of that payment

const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bool = (v, d = false) => (typeof v === "boolean" ? v : d);

/** Variables a template slot can use: {key}. sample = shown in the preview. */
export const WA_VARIABLES = [
  { key: "name", label: "सदस्य का नाम", sample: "रमेश कुमार" },
  { key: "father", label: "पिता / पति का नाम", sample: "सुरेश कुमार" },
  { key: "regNo", label: "रजि. नंबर", sample: "R100045" },
  { key: "program", label: "योजना", sample: "विवाह सहायता योजना" },
  { key: "trust", label: "ट्रस्ट का नाम", sample: "मेरा घांची समाज फाउंडेशन" },
  { key: "village", label: "गाँव", sample: "पाली" },
  { key: "phone", label: "मोबाइल", sample: "9876543210" },
  { key: "agent", label: "एजेंट", sample: "सुरेश जी" },
  { key: "joinDate", label: "जुड़ने की तारीख", sample: "18-10-2026" },
  { key: "payAmount", label: "प्रति क्लोजिंग राशि", sample: "200" },
  { key: "pendingAmount", label: "कुल बकाया राशि", sample: "600" },
  { key: "pendingCount", label: "बकाया क्लोजिंग (संख्या)", sample: "3" },
  { key: "closingNames", label: "बकाया क्लोजिंग के नाम", sample: "मोहन (पाली), गीता (जोधपुर)" },
  { key: "lastDate", label: "अंतिम तिथि", sample: "30-10-2026" },
  { key: "paidAmount", label: "जमा राशि (इस भुगतान की)", sample: "400" },
  { key: "paidCount", label: "जमा क्लोजिंग (संख्या)", sample: "2" },
  { key: "paidDate", label: "जमा की तारीख", sample: "18-10-2026" },
  { key: "loginId", label: "ऐप लॉगिन ID", sample: "r100045" },
  { key: "pdfLink", label: "PDF लिंक (प्रमाण पत्र / रसीद)", sample: "https://…/rasid.pdf" },
  { key: "trustPhone", label: "ट्रस्ट का संपर्क नंबर", sample: "9876500000" },
  { key: "today", label: "आज की तारीख", sample: "18-10-2026" },
];
const VAR_KEYS = new Set(WA_VARIABLES.map((v) => v.key));

export const WA_EVENTS = [
  { key: "join", label: "1. सदस्य जुड़ने पर", desc: "Member jodte / request accept karte waqt \"WhatsApp bhejein\" tick karne par — certificate PDF ke saath (chalu = form mein tick box dikhega)", media: "certificate" },
  { key: "pending", label: "2. बकाया भुगतान", desc: "Nayi closing par (auto) ya panel se bulk reminder — baki rasid PDF ke saath", media: "pendingReceipt" },
  { key: "paid", label: "3. भुगतान जमा", desc: "Payment entry hote hi — us payment ki paid rasid PDF ke saath", media: "paidReceipt" },
];
export const WA_MEDIA = { certificate: "प्रमाण पत्र PDF", pendingReceipt: "बकाया रसीद PDF", paidReceipt: "जमा रसीद PDF", none: "PDF नहीं (सिर्फ text)" };

const EVENT_DEFAULTS = {
  join: ["{name}", "{regNo}", "{program}", "{trust}"],
  pending: ["{name}", "{pendingAmount}", "{lastDate}", "{trust}"],
  paid: ["{name}", "{paidAmount}", "{paidDate}", "{trust}"],
};

function normEvent(key, raw) {
  const e = raw && typeof raw === "object" ? raw : {};
  const def = WA_EVENTS.find((x) => x.key === key);
  const params = Array.isArray(e.params) ? e.params.slice(0, 20).map((p) => str(String(p ?? ""), 300)) : EVENT_DEFAULTS[key];
  return {
    on: bool(e.on),
    templateId: str(e.templateId, 120),
    body: str(e.body, 1500),
    params,
    media: Object.hasOwn(WA_MEDIA, e.media) ? e.media : def.media,
    ...(key === "pending" ? { onClosing: bool(e.onClosing, true) } : {}),
  };
}

export const WA_DEFAULTS = normalizeWhatsapp({});

/** Whatever was saved → full, safe settings. */
export function normalizeWhatsapp(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const ev = r.events && typeof r.events === "object" ? r.events : {};
  return {
    enabled: bool(r.enabled),
    provider: "gupshup",
    apiKey: str(r.apiKey, 200),
    source: digits(r.source),            // WhatsApp business number, 91XXXXXXXXXX
    appName: str(r.appName, 80),          // Gupshup app name (src.name)
    secret: /^[a-f0-9]{24,64}$/.test(String(r.secret || "")) ? r.secret : "",
    events: Object.fromEntries(WA_EVENTS.map((e) => [e.key, normEvent(e.key, ev[e.key])])),
  };
}

/** For the panel: never send the full API key back. */
export function publicWhatsapp(s) {
  const k = s.apiKey;
  return { ...s, apiKey: "", apiKeySet: !!k, apiKeyHint: k ? `••••${k.slice(-4)}` : "" };
}

/** Merge a save from the panel: an empty apiKey keeps the saved one. */
export function mergeWhatsapp(saved, input) {
  const s = normalizeWhatsapp(saved);
  const next = normalizeWhatsapp({ ...s, ...input, secret: s.secret, events: { ...s.events, ...(input?.events || {}) } });
  if (!str(input?.apiKey, 200)) next.apiKey = s.apiKey;
  return next;
}

export const ready = (s) => !!(s?.enabled && s.apiKey && s.source && s.appName);

/** "+91 98765-43210" → "919876543210"; other lengths kept as digits. */
export function digits(v) {
  return String(v ?? "").replace(/\D/g, "").slice(0, 15);
}
export function waPhone(v) {
  const d = digits(v);
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  return d.length >= 11 ? d : "";
}

/** Count {{1}} … {{n}} in a template text. */
export function slotCount(body) {
  let n = 0;
  for (const m of String(body || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)) n = Math.max(n, Number(m[1]));
  return n;
}

/** "{name} ji" + vars → "रमेश ji". Unknown {x} stays as is. */
export function fill(text, vars) {
  return String(text ?? "").replace(/\{(\w+)\}/g, (all, k) => (VAR_KEYS.has(k) ? String(vars?.[k] ?? "") : all));
}

/** Template text with its {{n}} replaced by the filled params (panel preview + saved body). */
export function preview(body, params) {
  return String(body || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n) => params[Number(n) - 1] ?? all);
}

export const sampleVars = () => Object.fromEntries(WA_VARIABLES.map((v) => [v.key, v.sample]));
