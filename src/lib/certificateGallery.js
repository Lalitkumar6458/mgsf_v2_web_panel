// Ready-made certificate designs for the builder's "Design gallery". Each one is a normal template
// (artwork pixels on an A5-landscape page) drawn only with boxes, text and fields — no frame
// artwork needed — so it prints well straight away and the trust can change anything after picking.
//
// Inspired by the certificates of the other trust panels (Marudhar, Sanwalaji/Radhika, SRKSF,
// MHSSS, MKCT, GSMSY). Trust name / address / logos / stamp come from Settings → Organization.
import { DEFAULT_TEMPLATE, ELEMENT_DEFAULTS } from "./certificateTemplate.js";

const ART = { w: 1104, h: 739 };
const A5L = { wmm: 210, hmm: 148 };

let seq = 0;
const id = (p) => `${p}_${(seq++).toString(36)}`;
const base = (o) => ({ ...ELEMENT_DEFAULTS, ...o });

const T = (x, y, text, o = {}) => base({ id: id("t"), type: "text", x, y, text, fontSize: 15, ...o });
const F = (x, y, fieldKey, w, o = {}) => base({ id: id("f"), type: "field", x, y, fieldKey, w, fontSize: 16, color: "#000000", underline: "dotted", ...o });
const B = (x, y, w, h, o = {}) => base({ id: id("b"), type: "box", x, y, w, h, text: "", ...o });
const IMG = (x, y, w, h, fieldKey, o = {}) => base({ id: id("i"), type: "image", x, y, w, h, fieldKey, ...o });

/** label + dotted value: "नाम ........ रमेश कुमार" */
const pair = (x, y, label, key, lw, fw, o = {}) => [
  T(x, y, label, { fontSize: o.labelSize || 15, color: o.labelColor || "#3f3f46", bold: o.labelBold ?? false }),
  F(x + lw, y - 1, key, fw, { fontSize: o.size || 16, color: o.valueColor || "#000000", underline: o.underline ?? "dotted", ...(o.field || {}) }),
];

/** "प्रत्येक मायरा पर सहयोग राशि ₹ 300 /-" — the word follows the yojna (मायरा / विवाह / देहांत) */
const feeLine = (x, y, lw, fw, o = {}) => [
  F(x, y, "closingWord", lw, { underline: "none", fontSize: 15, color: o.labelColor || "#3f3f46", bold: false, prefix: "प्रत्येक ", suffix: " पर सहयोग राशि" }),
  F(x + lw, y - 1, "feeAmount", fw, { prefix: "₹ ", suffix: " /-", fontSize: 16 }),
];

/** "लेबल : मान" two-column style (no dotted line) */
const colon = (x, y, label, key, lw, fw, o = {}) => [
  T(x, y, label, { fontSize: 15, color: o.labelColor || "#7f1d1d", bold: true }),
  T(x + lw - 14, y, ":", { fontSize: 15, color: "#555555" }),
  F(x + lw, y, key, fw, { fontSize: 15.5, underline: "none", color: "#111111", ...(o.field || {}) }),
];

/** name over a line, role under it: signature block */
const sign = (cx, y, key, role, o = {}) => [
  F(cx - 150, y, key, 300, { align: "center", underline: "none", fontSize: 15, color: o.color || "#111111", ...(o.field || {}) }),
  B(cx - 130, y + 28, 260, 1.5, { bg: o.line || "#6b7280" }),
  T(cx - 150, y + 36, role, { w: 300, align: "center", fontSize: 14, color: o.roleColor || "#7f1d1d" }),
];

/** three "॥ श्री … ॥" invocation lines across the top */
const titles = (y, color, left = 60, width = 984) => {
  const w = width / 3;
  return [
    F(left, y, "trust.title1", w, { align: "left", underline: "none", fontSize: 14, color }),
    F(left + w, y, "trust.title2", w, { align: "center", underline: "none", fontSize: 14, color }),
    F(left + 2 * w, y, "trust.title3", w, { align: "right", underline: "none", fontSize: 14, color }),
  ];
};

/* ── 1. Classic Maroon (Marudhar / MGSF style) ─────────────────────────── */
function classicMaroon() {
  const M = "#8B0000", BROWN = "#7c3f12";
  const L = 60, R = 520, rows = [318, 360, 402, 444, 486];
  return {
    key: "classic-maroon",
    name: "Classic Maroon",
    hi: "पारंपरिक मैरून",
    note: "मरुधर / MGSF जैसा — क्रीम कागज़, मैरून दोहरी बॉर्डर",
    bg: { color: "#fffbef" },
    elements: [
      B(14, 14, 1076, 711, { border: 5, borderColor: M, radius: 8 }),
      B(28, 28, 1048, 683, { border: 1.5, borderColor: "#c9a227", radius: 5 }),
      ...titles(44, M),
      IMG(56, 74, 104, 104, "trust.logo", { fit: "contain", bg: "transparent" }),
      IMG(944, 74, 104, 104, "trust.RightLogo", { fit: "contain", bg: "transparent" }),
      F(170, 74, "trust.name", 764, { align: "center", underline: "none", fontSize: 40, color: M }),
      F(170, 130, "trust.address", 764, { align: "center", underline: "none", fontSize: 14, color: BROWN }),
      F(170, 152, "trust.contact", 764, { align: "center", underline: "none", fontSize: 14, color: BROWN, prefix: "संपर्क : " }),
      F(170, 174, "trust.regNo", 764, { align: "center", underline: "none", fontSize: 13, color: "#1f2937" }),
      B(392, 206, 320, 38, { fieldKey: "programName", bg: "#1a0f5e", color: "#ffffff", radius: 19, align: "center", vcenter: true, fontSize: 18 }),
      ...pair(L, 270, "सदस्यता क्रमांक", "memberNo", 128, 170),
      ...pair(680, 270, "दिनांक", "dateJoin", 58, 150),
      IMG(944, 262, 104, 136, "photoURL", { border: 1.5, borderColor: BROWN, radius: 4 }),
      ...pair(L, rows[0], "नाम", "displayName", 44, 400),
      ...pair(R, rows[0], "पिता / पति का नाम", "fatherName", 146, 260),
      ...pair(L, rows[1], "गोत्र", "gotra", 44, 180),
      ...pair(290, rows[1], "जाति", "jati", 44, 170),
      ...pair(R, rows[1], "जन्म तिथि", "bobDate", 86, 170),
      ...pair(L, rows[2], "मोबाइल नं.", "phone", 88, 200),
      ...pair(R, rows[2], "गाँव / शहर", "village", 90, 310),
      ...pair(L, rows[3], "जिला", "district", 44, 360),
      ...pair(R, rows[3], "राज्य", "state", 50, 480),
      ...pair(L, rows[4], "वारिसदार", "guardian", 80, 330),
      ...pair(R, rows[4], "सम्बन्ध", "guardianRelation", 64, 466),
      ...feeLine(L, 532, 230, 170),
      B(L, 572, 984, 34, { fieldKey: "program.noteLine", fallback: "नियम व शर्तें लागू", border: 1, borderColor: "#d6c8a0", borderStyle: "dashed", radius: 6, align: "left", vcenter: true, fontSize: 13, color: "#7c2d12", bold: false, bg: "#fffdf5" }),
      ...sign(230, 636, "agentName", "कार्यकर्ता"),
      IMG(600, 600, 110, 110, "trust.stampImg", { fit: "contain", bg: "transparent", opacity: 0.9 }),
      ...sign(870, 636, "trust.trustPresident", "संचालक / अध्यक्ष"),
    ],
  };
}

/* ── 2. Golden Frame (Sanwalaji / Radhika style) ───────────────────────── */
function goldenFrame() {
  const GOLD = "#c9a227", M = "#7f1d1d";
  const L = 70, R = 540, rows = [326, 366, 406, 446, 486];
  const lab = { labelColor: "#52525b" };
  return {
    key: "golden-frame",
    name: "Golden Frame",
    hi: "सुनहरी फ्रेम",
    note: "साँवलाजी / राधिका जैसा — सुनहरी चौड़ी बॉर्डर, दोनों तरफ लोगो",
    bg: { color: "#ffffff" },
    elements: [
      B(10, 10, 1084, 719, { border: 12, borderColor: GOLD, radius: 4 }),
      B(34, 34, 1036, 671, { border: 1.5, borderColor: GOLD, radius: 2 }),
      ...titles(48, M, 70, 964),
      IMG(66, 80, 112, 112, "trust.logo", { fit: "contain", bg: "transparent" }),
      IMG(926, 80, 112, 112, "trust.RightLogo", { fit: "contain", bg: "transparent" }),
      F(190, 76, "trust.name", 724, { align: "center", underline: "none", fontSize: 38, color: M }),
      F(190, 126, "trust.cityState", 724, { align: "center", underline: "none", fontSize: 19, color: "#111111" }),
      F(190, 154, "trust.address", 724, { align: "center", underline: "none", fontSize: 13, color: "#3f3f46", bold: false }),
      F(190, 174, "trust.contact", 724, { align: "center", underline: "none", fontSize: 13, color: "#111111" }),
      B(402, 208, 300, 38, { fieldKey: "programName", bg: M, color: "#ffffff", radius: 6, align: "center", vcenter: true, fontSize: 18 }),
      B(938, 4, 140, 30, { fieldKey: "memberNo", bg: "#ffffff", border: 1.5, borderColor: GOLD, radius: 6, align: "center", vcenter: true, fontSize: 15, color: M }),
      ...pair(L, 274, "सदस्यता क्रमांक", "memberNo", 128, 170, lab),
      ...pair(680, 274, "दिनांक", "dateJoin", 58, 160, lab),
      IMG(930, 264, 104, 136, "photoURL", { border: 2, borderColor: GOLD, radius: 6 }),
      ...pair(L, rows[0], "नाम", "displayName", 44, 410, lab),
      ...pair(R, rows[0], "पिता / पति का नाम", "fatherName", 146, 220, lab),
      ...pair(L, rows[1], "गोत्र", "gotra", 44, 170, lab),
      ...pair(290, rows[1], "जाति", "jati", 44, 180, lab),
      ...pair(R, rows[1], "जन्म तिथि", "bobDate", 86, 180, lab),
      ...pair(L, rows[2], "मोबाइल नं.", "phone", 88, 200, lab),
      ...pair(R, rows[2], "गाँव / शहर", "village", 90, 290, lab),
      ...pair(L, rows[3], "जिला", "district", 44, 390, lab),
      ...pair(R, rows[3], "राज्य", "state", 50, 444, lab),
      ...pair(L, rows[4], "वारिसदार", "guardian", 80, 380, lab),
      ...feeLine(R, rows[4], 230, 190, lab),
      B(L, 534, 964, 52, { fieldKey: "program.noteLine", fallback: "नियम व शर्तें लागू", border: 1, borderColor: "#e4d5a4", radius: 6, align: "left", vcenter: true, fontSize: 13, color: "#52525b", bold: false, bg: "#fffbeb" }),
      ...sign(250, 620, "agentName", "कार्यकर्ता", { roleColor: M }),
      IMG(596, 590, 110, 110, "trust.stampImg", { fit: "contain", bg: "transparent", opacity: 0.9 }),
      ...sign(860, 620, "trust.trustPresident", "संस्थापक", { roleColor: M }),
    ],
  };
}

/* ── 3. Royal Blue (SRKSF style) ───────────────────────────────────────── */
function royalBlue() {
  const BLUE = "#1d4e89", NAVY = "#0f2a4a";
  const L = 64, R = 520, rows = [318, 358, 398, 438, 478];
  return {
    key: "royal-blue",
    name: "Royal Blue",
    hi: "शाही नीला",
    note: "SRKSF जैसा — नीली दोहरी बॉर्डर, ऊपर सदस्यता क्रमांक का टैग",
    bg: { color: "#ffffff" },
    elements: [
      B(12, 22, 1080, 705, { border: 6, borderColor: BLUE, radius: 6 }),
      B(30, 40, 1044, 669, { border: 1.5, borderColor: "#5b84b8", radius: 4 }),
      B(900, 8, 170, 30, { fieldKey: "memberNo", bg: "#ffffff", border: 2, borderColor: BLUE, radius: 4, align: "center", vcenter: true, fontSize: 15, color: NAVY }),
      ...titles(56, "#8B0000"),
      IMG(56, 86, 100, 100, "trust.logo", { fit: "contain", bg: "transparent" }),
      IMG(948, 86, 100, 100, "trust.RightLogo", { fit: "contain", bg: "transparent" }),
      F(170, 84, "trust.name", 764, { align: "center", underline: "none", fontSize: 38, color: "#8B0000" }),
      F(170, 134, "trust.cityState", 764, { align: "center", underline: "none", fontSize: 18, color: NAVY }),
      F(170, 160, "trust.address", 764, { align: "center", underline: "none", fontSize: 13, color: "#475569", bold: false }),
      F(170, 180, "trust.contact", 764, { align: "center", underline: "none", fontSize: 13, color: NAVY, prefix: "Contact No. : " }),
      B(402, 212, 300, 36, { fieldKey: "programName", bg: NAVY, color: "#ffffff", radius: 18, align: "center", vcenter: true, fontSize: 17 }),
      ...pair(L, 272, "सदस्यता क्रमांक", "memberNo", 128, 170),
      ...pair(680, 272, "दिनांक", "dateJoin", 58, 150),
      IMG(944, 262, 104, 136, "photoURL", { border: 1.5, borderColor: BLUE, radius: 4 }),
      ...pair(L, rows[0], "नाम", "displayName", 44, 400),
      ...pair(R, rows[0], "पिता / पति का नाम", "fatherName", 146, 260),
      ...pair(L, rows[1], "गोत्र", "gotra", 44, 180),
      ...pair(290, rows[1], "जाति", "jati", 44, 170),
      ...pair(R, rows[1], "जन्म तिथि", "bobDate", 86, 170),
      ...pair(L, rows[2], "मोबाइल नं.", "phone", 88, 200),
      ...pair(R, rows[2], "गाँव / शहर", "village", 90, 310),
      ...pair(L, rows[3], "जिला", "district", 44, 360),
      ...pair(R, rows[3], "राज्य", "state", 50, 480),
      ...pair(L, rows[4], "वारिसदार", "guardian", 80, 330),
      ...feeLine(R, rows[4], 230, 200),
      B(L, 528, 980, 40, { fieldKey: "program.noteLine", fallback: "नियम व शर्तें लागू", border: 1, borderColor: "#c7d7ee", radius: 6, align: "left", vcenter: true, fontSize: 13, color: "#9a3412", bold: false, bg: "#f5f8fd" }),
      ...sign(240, 616, "agentName", "कार्यकर्ता", { roleColor: NAVY }),
      IMG(596, 590, 110, 110, "trust.stampImg", { fit: "contain", bg: "transparent", opacity: 0.9 }),
      ...sign(860, 616, "trust.trustPresident", "संचालक", { roleColor: NAVY }),
    ],
  };
}

/* ── 4. Digit Boxes (MHSSS style) ──────────────────────────────────────── */
function digitBoxes() {
  const M = "#7f1d1d", SAFF = "#c2410c";
  const L = 60, R = 560, rows = [300, 340, 380, 420, 460];
  return {
    key: "digit-boxes",
    name: "Digit Boxes",
    hi: "अंक बॉक्स",
    note: "MHSSS जैसा — क्रमांक और दिनांक अलग-अलग खानों में, लेबल : मान",
    bg: { color: "#fffaf3" },
    elements: [
      B(16, 16, 1072, 707, { border: 3, borderColor: SAFF, radius: 10 }),
      B(16, 16, 1072, 150, { bg: "#fff1e6", radius: 10 }),
      IMG(44, 34, 110, 110, "trust.logo", { fit: "contain", bg: "transparent" }),
      F(170, 34, "trust.title1", 764, { align: "center", underline: "none", fontSize: 14, color: SAFF }),
      F(170, 58, "trust.name", 764, { align: "center", underline: "none", fontSize: 38, color: M }),
      F(170, 110, "trust.address", 764, { align: "center", underline: "none", fontSize: 14, color: "#57534e", bold: false }),
      F(170, 132, "trust.contact", 764, { align: "center", underline: "none", fontSize: 14, color: "#57534e", prefix: "मो. " }),
      IMG(950, 34, 110, 110, "trust.RightLogo", { fit: "contain", bg: "transparent" }),
      T(L, 188, "सदस्यता क्रमांक", { fontSize: 15, color: M }),
      F(L, 214, "memberNo", 190, { charBoxes: 6, h: 34, fontSize: 18, border: 1.5, borderColor: "#292524", bg: "#ffffff" }),
      B(400, 206, 304, 42, { fieldKey: "programName", bg: M, color: "#ffffff", radius: 4, align: "center", vcenter: true, fontSize: 19 }),
      T(760, 188, "दिनांक", { fontSize: 15, color: M, w: 284, align: "right" }),
      F(764, 214, "dateJoin", 280, { charBoxes: 10, h: 34, fontSize: 17, border: 1.5, borderColor: "#292524", bg: "#ffffff" }),
      ...colon(L, rows[0], "नाम", "displayName", 150, 330),
      ...colon(R, rows[0], "जन्म तिथि", "bobDate", 140, 200),
      ...colon(L, rows[1], "पिता / पति का नाम", "fatherName", 150, 330),
      ...colon(R, rows[1], "आधार नं.", "aadhaarNo", 140, 200),
      ...colon(L, rows[2], "मोबाइल नं.", "phone", 150, 330),
      ...colon(R, rows[2], "उम्र", "age", 140, 200),
      ...colon(L, rows[3], "वारिसदार", "guardian", 150, 330),
      ...colon(R, rows[3], "सम्बन्ध", "guardianRelation", 140, 200),
      ...colon(L, rows[4], "गाँव", "village", 150, 330),
      ...colon(R, rows[4], "जिला & राज्य", "districtState", 140, 200),
      ...colon(L, 500, "कार्यकर्ता", "agentName", 150, 330),
      ...colon(R, 500, "सहयोग राशि", "feeAmount", 140, 200, { field: { prefix: "₹ ", suffix: " /-" } }),
      IMG(918, 290, 120, 150, "photoURL", { border: 1.5, borderColor: "#292524", radius: 2 }),
      B(L, 548, 984, 2, { bg: "#dc2626", border: 0 }),
      B(L, 560, 984, 34, { fieldKey: "program.noteLine", fallback: "नियम व शर्तें लागू", border: 1, borderColor: "#d6d3d1", radius: 4, align: "left", vcenter: true, fontSize: 13, color: "#57534e", bold: false, bg: "#ffffff" }),
      ...sign(230, 640, "agentName", "कार्यकर्ता", { roleColor: M }),
      IMG(596, 606, 100, 100, "trust.stampImg", { fit: "contain", bg: "transparent", opacity: 0.9 }),
      ...sign(870, 640, "trust.trustPresident", "अध्यक्ष", { roleColor: M }),
    ],
  };
}

/* ── 5. Modern Minimal ─────────────────────────────────────────────────── */
function modernMinimal() {
  const TEAL = "#0f766e", INK = "#0f172a";
  const L = 92, rows = [256, 300, 344, 388, 432, 476];
  const zebra = rows.map((y, i) => B(L - 14, y - 9, 816, 40, { bg: i % 2 ? "#ffffff" : "#f1f5f9", radius: 6 }));
  const cell = (x, y, label, key, w = 250, o = {}) => [
    T(x, y, label, { fontSize: 13, color: "#64748b", bold: false }),
    F(x + 120, y - 1, key, w, { underline: "none", fontSize: 16, color: INK, ...o }),
  ];
  return {
    key: "modern-minimal",
    name: "Modern Minimal",
    hi: "सादा आधुनिक",
    note: "साफ़ और आधुनिक — बाईं ओर रंगीन पट्टी, हल्की धारियों वाली पंक्तियाँ",
    bg: { color: "#ffffff" },
    elements: [
      B(0, 0, 40, 739, { bg: TEAL }),
      B(40, 0, 8, 739, { bg: "#5eead4" }),
      IMG(L - 10, 40, 92, 92, "trust.logo", { fit: "contain", bg: "transparent" }),
      F(L + 96, 46, "trust.name", 700, { underline: "none", fontSize: 34, color: INK }),
      F(L + 98, 94, "trust.address", 700, { underline: "none", fontSize: 13, color: "#64748b", bold: false }),
      F(L + 98, 114, "trust.contact", 700, { underline: "none", fontSize: 13, color: "#64748b", bold: false }),
      T(L, 168, "सदस्यता प्रमाण पत्र", { fontSize: 26, color: TEAL }),
      B(L + 250, 170, 260, 32, { fieldKey: "programName", bg: "#ccfbf1", color: TEAL, radius: 16, align: "center", vcenter: true, fontSize: 15 }),
      B(856, 40, 200, 64, { border: 1.5, borderColor: "#cbd5e1", radius: 10 }),
      T(870, 48, "सदस्यता क्रमांक", { fontSize: 12, color: "#64748b", bold: false }),
      F(870, 68, "memberNo", 170, { underline: "none", fontSize: 22, color: TEAL }),
      ...zebra,
      ...cell(L, rows[0], "नाम", "displayName"),
      ...cell(L + 400, rows[0], "पिता / पति", "fatherName"),
      ...cell(L, rows[1], "जन्म तिथि", "bobDate"),
      ...cell(L + 400, rows[1], "गोत्र", "gotra"),
      ...cell(L, rows[2], "मोबाइल", "phone"),
      ...cell(L + 400, rows[2], "गाँव", "village"),
      ...cell(L, rows[3], "जिला", "district"),
      ...cell(L + 400, rows[3], "राज्य", "state"),
      ...cell(L, rows[4], "वारिसदार", "guardian"),
      ...cell(L + 400, rows[4], "सम्बन्ध", "guardianRelation"),
      ...cell(L, rows[5], "जुड़ने की तिथि", "dateJoin"),
      ...cell(L + 400, rows[5], "सहयोग राशि", "feeAmount", 250, { prefix: "₹ ", suffix: " /-" }),
      IMG(924, 248, 132, 168, "photoURL", { border: 0, radius: 12, bg: "#f1f5f9" }),
      B(L - 14, 540, 816, 40, { fieldKey: "program.noteLine", fallback: "नियम व शर्तें लागू", radius: 6, align: "left", vcenter: true, fontSize: 13, color: "#475569", bold: false, bg: "#fefce8", border: 1, borderColor: "#fde68a" }),
      ...sign(260, 628, "agentName", "कार्यकर्ता", { roleColor: "#64748b", line: "#94a3b8" }),
      IMG(620, 596, 110, 110, "trust.stampImg", { fit: "contain", bg: "transparent", opacity: 0.9 }),
      ...sign(900, 628, "trust.trustPresident", "अध्यक्ष", { roleColor: "#64748b", line: "#94a3b8" }),
    ],
  };
}

/* ── 6. Saffron Seva ───────────────────────────────────────────────────── */
function saffronSeva() {
  const SAFF = "#ea580c", DARK = "#7c2d12";
  const L = 70, R = 540, rows = [300, 342, 384, 426, 468];
  return {
    key: "saffron-seva",
    name: "Kesariya Seva",
    hi: "केसरिया सेवा",
    note: "ऊपर केसरिया पट्टी में ट्रस्ट का नाम, नीचे हरी पट्टी",
    bg: { color: "#fffdf8" },
    elements: [
      B(0, 0, 1104, 176, { bg: SAFF }),
      B(0, 176, 1104, 6, { bg: "#fbbf24" }),
      B(0, 711, 1104, 28, { bg: "#15803d" }),
      ...titles(16, "#fff7ed", 60, 984),
      IMG(48, 42, 112, 112, "trust.logo", { fit: "contain", bg: "transparent" }),
      IMG(944, 42, 112, 112, "trust.RightLogo", { fit: "contain", bg: "transparent" }),
      F(170, 44, "trust.name", 764, { align: "center", underline: "none", fontSize: 40, color: "#ffffff" }),
      F(170, 100, "trust.address", 764, { align: "center", underline: "none", fontSize: 14, color: "#ffedd5" }),
      F(170, 124, "trust.contact", 764, { align: "center", underline: "none", fontSize: 14, color: "#ffedd5", prefix: "संपर्क : " }),
      F(170, 146, "trust.regNo", 764, { align: "center", underline: "none", fontSize: 12.5, color: "#fed7aa" }),
      B(402, 200, 300, 38, { fieldKey: "programName", bg: "#ffffff", border: 2, borderColor: SAFF, color: DARK, radius: 19, align: "center", vcenter: true, fontSize: 18 }),
      ...pair(L, 256, "सदस्यता क्रमांक", "memberNo", 128, 160),
      ...pair(700, 256, "दिनांक", "dateJoin", 58, 140),
      IMG(930, 250, 112, 140, "photoURL", { border: 2, borderColor: SAFF, radius: 6 }),
      ...pair(L, rows[0], "नाम", "displayName", 44, 410),
      ...pair(R, rows[0], "पिता / पति का नाम", "fatherName", 146, 220),
      ...pair(L, rows[1], "गोत्र", "gotra", 44, 170),
      ...pair(290, rows[1], "जाति", "jati", 44, 180),
      ...pair(R, rows[1], "जन्म तिथि", "bobDate", 86, 180),
      ...pair(L, rows[2], "मोबाइल नं.", "phone", 88, 200),
      ...pair(R, rows[2], "गाँव / शहर", "village", 90, 290),
      ...pair(L, rows[3], "जिला", "district", 44, 390),
      ...pair(R, rows[3], "राज्य", "state", 50, 444),
      ...pair(L, rows[4], "वारिसदार", "guardian", 80, 380),
      ...feeLine(R, rows[4], 230, 190),
      B(L, 516, 964, 36, { fieldKey: "program.noteLine", fallback: "नियम व शर्तें लागू", border: 1, borderColor: "#fed7aa", radius: 6, align: "left", vcenter: true, fontSize: 13, color: DARK, bold: false, bg: "#fff7ed" }),
      ...sign(250, 600, "agentName", "कार्यकर्ता", { roleColor: DARK }),
      IMG(596, 572, 110, 110, "trust.stampImg", { fit: "contain", bg: "transparent", opacity: 0.9 }),
      ...sign(860, 600, "trust.trustPresident", "अध्यक्ष", { roleColor: DARK }),
    ],
  };
}

/* ── 7. Frame artwork (GSMSY approved layout) ──────────────────────────── */
function frameArtwork() {
  return {
    key: "frame-artwork",
    name: "Apni Frame Image",
    hi: "अपनी फ्रेम इमेज",
    note: "GSMSY वाला लेआउट — छपी हुई फ्रेम (artwork) अपलोड करें, उस पर नाम-पता अपने आप बैठेंगे",
    bg: { color: "#ffffff" },
    elements: DEFAULT_TEMPLATE.elements.map((e) => ({ ...e })),
  };
}

/* ── 8. Blank page ─────────────────────────────────────────────────────── */
function blankPage() {
  return {
    key: "blank",
    name: "Khaali Page",
    hi: "खाली पेज",
    note: "शुरू से अपना डिज़ाइन — सिर्फ़ एक बॉर्डर; बाकी “तैयार ब्लॉक” से जोड़ें",
    bg: { color: "#ffffff" },
    elements: [B(18, 18, 1068, 703, { border: 3, borderColor: "#8B0000", radius: 8 })],
  };
}

export const GALLERY = [blankPage(), classicMaroon(), goldenFrame(), royalBlue(), digitBoxes(), modernMinimal(), saffronSeva(), frameArtwork()];

/** A gallery design → a fresh (unsaved) template the builder can open. */
export function templateFromGallery(key) {
  const g = GALLERY.find((x) => x.key === key);
  if (!g) return null;
  return {
    id: null,
    name: g.name,
    isDefault: false,
    programId: null,
    page: { ...A5L },
    art: { ...ART },
    bg: { ...g.bg },
    frameImg: "",
    gallery: g.key,
    elements: g.elements.map((e) => ({ ...e, id: `${e.id}_${Math.random().toString(36).slice(2, 7)}` })),
  };
}

/* ── Ready blocks: one click drops a whole section (they arrive selected, so they move together) ── */
const M = "#8B0000";
export const BLOCKS = [
  {
    key: "border", label: "दोहरी बॉर्डर", hint: "पूरे पेज पर बाहर मोटी, अंदर पतली लाइन",
    make: () => [B(14, 14, 1076, 711, { border: 5, borderColor: M, radius: 8 }), B(28, 28, 1048, 683, { border: 1.5, borderColor: "#c9a227", radius: 5 })],
  },
  {
    key: "header", label: "हेडर (ट्रस्ट नाम, पता, लोगो)", hint: "ऊपर की पंक्तियाँ, दोनों लोगो, नाम, पता, संपर्क, रजि. नं.",
    make: (y = 44) => [
      ...titles(y, M),
      IMG(56, y + 30, 104, 104, "trust.logo", { fit: "contain", bg: "transparent" }),
      IMG(944, y + 30, 104, 104, "trust.RightLogo", { fit: "contain", bg: "transparent" }),
      F(170, y + 30, "trust.name", 764, { align: "center", underline: "none", fontSize: 40, color: M }),
      F(170, y + 86, "trust.address", 764, { align: "center", underline: "none", fontSize: 14, color: "#7c3f12" }),
      F(170, y + 108, "trust.contact", 764, { align: "center", underline: "none", fontSize: 14, color: "#7c3f12", prefix: "संपर्क : " }),
      F(170, y + 130, "trust.regNo", 764, { align: "center", underline: "none", fontSize: 13, color: "#1f2937" }),
    ],
  },
  {
    key: "title", label: "शीर्षक “सदस्यता प्रमाण पत्र”", hint: "बड़े अक्षरों में बीच में",
    make: (y = 200) => [T(302, y, "सदस्यता प्रमाण पत्र", { w: 500, align: "center", fontSize: 30, color: M })],
  },
  {
    key: "scheme", label: "योजना का नाम (पिल)", hint: "गोल किनारों वाली पट्टी में योजना",
    make: (y = 206) => [B(392, y, 320, 38, { fieldKey: "programName", bg: "#1a0f5e", color: "#ffffff", radius: 19, align: "center", vcenter: true, fontSize: 18 })],
  },
  {
    key: "numberDate", label: "सदस्यता क्रमांक + दिनांक", hint: "एक पंक्ति: क्रमांक बाएँ, दिनांक दाएँ",
    make: (y = 270) => [...pair(60, y, "सदस्यता क्रमांक", "memberNo", 128, 170), ...pair(680, y, "दिनांक", "dateJoin", 58, 150)],
  },
  {
    key: "numberBoxes", label: "क्रमांक + दिनांक (अलग-अलग खाने)", hint: "0 0 4 7 3 जैसे बॉक्स",
    make: (y = 190) => [
      T(60, y, "सदस्यता क्रमांक", { fontSize: 15, color: M }),
      F(60, y + 26, "memberNo", 190, { charBoxes: 6, h: 34, fontSize: 18, border: 1.5, borderColor: "#292524", bg: "#ffffff" }),
      T(760, y, "दिनांक", { fontSize: 15, color: M, w: 284, align: "right" }),
      F(764, y + 26, "dateJoin", 280, { charBoxes: 10, h: 34, fontSize: 17, border: 1.5, borderColor: "#292524", bg: "#ffffff" }),
    ],
  },
  {
    key: "details", label: "सदस्य विवरण (डॉट लाइन)", hint: "नाम, पिता, गोत्र, जन्म, मोबाइल, गाँव, जिला, राज्य, वारिसदार, राशि",
    make: (y = 318) => {
      const L = 60, R = 520, r = [y, y + 42, y + 84, y + 126, y + 168];
      return [
        ...pair(L, r[0], "नाम", "displayName", 44, 400), ...pair(R, r[0], "पिता / पति का नाम", "fatherName", 146, 260),
        ...pair(L, r[1], "गोत्र", "gotra", 44, 180), ...pair(290, r[1], "जाति", "jati", 44, 170), ...pair(R, r[1], "जन्म तिथि", "bobDate", 86, 170),
        ...pair(L, r[2], "मोबाइल नं.", "phone", 88, 200), ...pair(R, r[2], "गाँव / शहर", "village", 90, 310),
        ...pair(L, r[3], "जिला", "district", 44, 360), ...pair(R, r[3], "राज्य", "state", 50, 480),
        ...pair(L, r[4], "वारिसदार", "guardian", 80, 330), ...feeLine(R, r[4], 230, 190),
      ];
    },
  },
  {
    key: "detailsColon", label: "सदस्य विवरण (लेबल : मान)", hint: "दो कॉलम, बिना डॉट लाइन",
    make: (y = 300) => {
      const L = 60, R = 560, r = [y, y + 40, y + 80, y + 120, y + 160];
      return [
        ...colon(L, r[0], "नाम", "displayName", 150, 330), ...colon(R, r[0], "जन्म तिथि", "bobDate", 140, 200),
        ...colon(L, r[1], "पिता / पति का नाम", "fatherName", 150, 330), ...colon(R, r[1], "आधार नं.", "aadhaarNo", 140, 200),
        ...colon(L, r[2], "मोबाइल नं.", "phone", 150, 330), ...colon(R, r[2], "उम्र", "age", 140, 200),
        ...colon(L, r[3], "वारिसदार", "guardian", 150, 330), ...colon(R, r[3], "सम्बन्ध", "guardianRelation", 140, 200),
        ...colon(L, r[4], "गाँव", "village", 150, 330), ...colon(R, r[4], "जिला & राज्य", "districtState", 140, 200),
      ];
    },
  },
  {
    key: "photo", label: "सदस्य फोटो", hint: "दाईं ओर फोटो का खाना",
    make: (y = 262) => [IMG(944, y, 104, 136, "photoURL", { border: 1.5, borderColor: "#7c3f12", radius: 4 })],
  },
  {
    key: "rules", label: "नियम / नोट बॉक्स", hint: "योजना का Certificate Note, खाली हो तो “नियम व शर्तें लागू”",
    make: (y = 572) => [B(60, y, 984, 34, { fieldKey: "program.noteLine", fallback: "नियम व शर्तें लागू", border: 1, borderColor: "#d6c8a0", borderStyle: "dashed", radius: 6, align: "left", vcenter: true, fontSize: 13, color: "#7c2d12", bold: false, bg: "#fffdf5" })],
  },
  {
    key: "signatures", label: "हस्ताक्षर (कार्यकर्ता + मुहर + अध्यक्ष)", hint: "नीचे दोनों हस्ताक्षर, बीच में ट्रस्ट की मुहर",
    make: (y = 636) => [
      ...sign(230, y, "agentName", "कार्यकर्ता"),
      IMG(600, y - 36, 110, 110, "trust.stampImg", { fit: "contain", bg: "transparent", opacity: 0.9 }),
      ...sign(870, y, "trust.trustPresident", "संचालक / अध्यक्ष"),
    ],
  },
  {
    key: "watermark", label: "वॉटरमार्क लोगो", hint: "बीच में बड़ा हल्का लोगो (10%)",
    make: () => [IMG(402, 220, 300, 300, "trust.logo", { fit: "contain", bg: "transparent", opacity: 0.1 })],
  },
];

/** fresh ids for a block's elements (so a block can be added twice) */
export function blockElements(key, y) {
  const b = BLOCKS.find((x) => x.key === key);
  if (!b) return [];
  return b.make(y).map((e) => ({ ...e, id: `${e.type}_${Math.random().toString(36).slice(2, 9)}` }));
}
