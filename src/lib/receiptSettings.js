// रसीद (receipt) design settings — Settings → Rasid (stored in admins.extra.receipt).
// Pure module: used by the settings screen, the API and the PDF engine (lib/pdf/receipts.js).

export const RECEIPT_LAYOUTS = [
  { key: "a5", label: "A5 (आधा पेज)", desc: "Ek rasid ek A5 page — abhi jaisa", rows: 10 },
  { key: "a4", label: "A4 (पूरा पेज)", desc: "Bada page, ek page mein zyada entries", rows: 18 },
  { key: "a4x2", label: "A4 pe 2 rasid", desc: "A4 landscape pe 2 A5 rasid — kaat ke dein, kaagaz aadha", rows: 10 },
  { key: "thermal", label: "80mm thermal slip", desc: "Agent ke chhote printer ke liye lambi patti", rows: 999 },
];

export const RECEIPT_THEMES = [
  { key: "classic", label: "Classic navy", primary: "#1e2938", accent: "#d6262a", bg: "#fffdf4", row: "#fdf9e7", soft: "#eceef1" },
  { key: "saffron", label: "Kesariya", primary: "#7c2d12", accent: "#ea580c", bg: "#fffaf3", row: "#fff1e0", soft: "#fde7cf" },
  { key: "green", label: "Hara", primary: "#14532d", accent: "#15803d", bg: "#f7fdf8", row: "#eafbf0", soft: "#d9f2e3" },
  { key: "royal", label: "Royal blue", primary: "#1e3a8a", accent: "#b45309", bg: "#f8faff", row: "#eef3ff", soft: "#dfe7fb" },
  { key: "mono", label: "Black & white (kam ink)", primary: "#111111", accent: "#111111", bg: "#ffffff", row: "#f4f4f4", soft: "#ececec" },
];

export const DEFAULT_RECEIPT_SETTINGS = {
  layout: "a5",
  theme: "classic",
  pendingTitle: "बकाया सूचना",
  paidTitle: "भुगतान रसीद",
  showUpiQr: false,
  upiId: "",
  upiName: "",
  dueDays: 15,               // pending: "अंतिम तिथि" = print date + N days (0 = not shown)
  showVerifyQr: true,        // paid: QR that opens /verify/r/<code>
  showAmountWords: true,
  showWatermark: true,       // paid: faint "भुगतान प्राप्त" across the page
  showStamp: true,           // trust stamp image (Settings → Organization)
  signImg: "",               // uploaded signature (optional)
  pendingNote: "कृपया अंतिम तिथि से पहले भुगतान करें। भुगतान के बाद रसीद अवश्य लें।",
  paidNote: "यह दान स्वैच्छिक है और किसी भी कारण से वापसी योग्य नहीं है।",
};

const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.]{1,64}$/;
export const isUpiId = (v) => UPI_RE.test(String(v || "").trim());

const str = (v, max, d = "") => (typeof v === "string" ? v.trim().slice(0, max) : d);
const bool = (v, d) => (typeof v === "boolean" ? v : d);
const imgUrl = (v) => {
  const s = str(v, 500);
  return /^https?:\/\//i.test(s) || s.startsWith("/api/files/") ? s : "";
};

export function normalizeReceiptSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const D = DEFAULT_RECEIPT_SETTINGS;
  const dueDays = Number(r.dueDays);
  const upiId = str(r.upiId, 120);
  return {
    layout: RECEIPT_LAYOUTS.some((l) => l.key === r.layout) ? r.layout : D.layout,
    theme: RECEIPT_THEMES.some((t) => t.key === r.theme) ? r.theme : D.theme,
    pendingTitle: str(r.pendingTitle, 40) || D.pendingTitle,
    paidTitle: str(r.paidTitle, 40) || D.paidTitle,
    showUpiQr: bool(r.showUpiQr, D.showUpiQr) && isUpiId(upiId),
    upiId: isUpiId(upiId) ? upiId : "",
    upiName: str(r.upiName, 60),
    dueDays: Number.isFinite(dueDays) && dueDays >= 0 && dueDays <= 365 ? Math.round(dueDays) : D.dueDays,
    showVerifyQr: bool(r.showVerifyQr, D.showVerifyQr),
    showAmountWords: bool(r.showAmountWords, D.showAmountWords),
    showWatermark: bool(r.showWatermark, D.showWatermark),
    showStamp: bool(r.showStamp, D.showStamp),
    signImg: imgUrl(r.signImg),
    pendingNote: typeof r.pendingNote === "string" ? r.pendingNote.trim().slice(0, 200) : D.pendingNote,
    paidNote: typeof r.paidNote === "string" ? r.paidNote.trim().slice(0, 200) : D.paidNote,
  };
}

export const themeOf = (key) => RECEIPT_THEMES.find((t) => t.key === key) || RECEIPT_THEMES[0];
export const layoutOf = (key) => RECEIPT_LAYOUTS.find((l) => l.key === key) || RECEIPT_LAYOUTS[0];

/** upi://pay link a phone's UPI app opens with the amount filled in. */
// The standard NPCI "upi://pay" link — Google Pay, PhonePe, Paytm, BHIM and bank apps all read it.
// Amount as "450.00" (blank / 0 = payer types it), spaces as %20 and the VPA's "@" left as is:
// some UPI apps reject "%40" or "+".
export function upiLink({ upiId, upiName, amount, note }) {
  const q = new URLSearchParams();
  q.set("pa", String(upiId || "").trim());
  q.set("pn", upiName || "Trust");
  const amt = Math.round(Number(amount) || 0);
  if (amt > 0) q.set("am", amt.toFixed(2));
  q.set("cu", "INR");
  if (note) q.set("tn", String(note).slice(0, 60));
  return `upi://pay?${q.toString().replace(/\+/g, "%20").replace(/%40/g, "@")}`;
}
