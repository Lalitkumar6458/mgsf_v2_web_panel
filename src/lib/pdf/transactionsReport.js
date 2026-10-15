// Transactions report (Payments page → PDF), drawn straight with pdfkit.
//
// Why not react-pdf like the other PDFs: its layout engine costs ~8 ms per table row, so a
// 50,000-payment report took ~7 minutes. pdfkit with fixed row positions does the same page
// in ~0.2 ms per row (50,000 rows ≈ 10 s). Same look as the old TransactionsReportPDF.
//
// Runs on the server only (in the PDF worker thread — see src/workers/receiptWorker.js).
import PDFDocument from "pdfkit";
import NotoSansDevanagari from "../../app/api/helperfile/static/font/NotoSansDevanagari.js";
import NotoSansDevanagariBold from "../../app/api/helperfile/static/font/NotoSansDevanagariBold.js";

const fontBuf = (dataUri) => Buffer.from(String(dataUri).split(",")[1] || "", "base64");
let FONTS = null;
const fonts = () => (FONTS ??= { R: fontBuf(NotoSansDevanagari), B: fontBuf(NotoSansDevanagariBold) });

const C = {
  maroon: "#8B0000", navy: "#1a1a4e", gold: "#c9a227", rowEven: "#fdf8f0", green: "#15803d",
  blue: "#1d4ed8", border: "#e5e7eb", sub: "#9ca3af", text: "#262626",
};

// A4 portrait
const W = 595.28, H = 841.89;
const X0 = 32, X1 = W - 32, CW = X1 - X0;            // content box inside the gold border
const TOP = 32, BOTTOM = H - 48;
const ROW_H = 24, HEAD_H = 22, TOTAL_H = 22, NOTICE_H = 34;
const FIRST_HEAD_H = 197, MINI_HEAD_H = 22;

// column widths (same proportions as before), scaled to the content width
const COLS = [
  ["no", 28, "क्र.", "center"], ["trx", 80, "TRX ID", "left"], ["date", 46, "तिथि", "center"],
  ["payer", 108, "भुगतानकर्ता", "left"], ["benef", 108, "लाभार्थी", "left"], ["amount", 58, "राशि (₹)", "right"],
  ["method", 46, "विधि", "center"], ["ref", 81, "रेफरेंस / नोट", "left"],
];
const SCALE = CW / COLS.reduce((s, c) => s + c[1], 0);
let _x = X0;
const COL = COLS.map(([key, w, label, align]) => { const c = { key, x: _x, w: w * SCALE, label, align }; _x += c.w; return c; });
const col = Object.fromEntries(COL.map((c) => [c.key, c]));

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const fmt = (n) => `₹${inr.format(Math.round(n || 0))}`;
const trunc = (s, n) => { s = String(s ?? "").trim(); return !s ? "" : s.length > n ? s.slice(0, n - 1) + "…" : s; };
const fmtD = (d) => {
  const s = String(d || "").slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : s || "-";
};

/** rows on each page: page 1 carries the big header; the last page also needs the total + notice */
export function paginate(n) {
  const first = Math.floor((BOTTOM - TOP - FIRST_HEAD_H - HEAD_H) / ROW_H);
  const next = Math.floor((BOTTOM - TOP - MINI_HEAD_H - HEAD_H) / ROW_H);
  const pages = [[0, Math.min(n, first)]];
  for (let i = pages[0][1]; i < n; i += next) pages.push([i, Math.min(n, i + next)]);
  const [a, b] = pages[pages.length - 1];
  const cap = pages.length === 1 ? first : next;
  const tailRows = Math.ceil((TOTAL_H + NOTICE_H + 8) / ROW_H);
  if (b - a > cap - tailRows) pages.push([n, n]); // total + notice on a page of their own
  return pages;
}

/**
 * @param {{ transactions: object[], summary?: object, programInfo?: object, filters?: object,
 *           generatedDate?: string, TrustData?: object }} props
 * @returns {Promise<Buffer>}
 */
export function buildTransactionsReport({ transactions = [], summary = {}, programInfo = {}, filters = {}, generatedDate, TrustData = {} }) {
  const trust = { ...TrustData, topTitle: Array.isArray(TrustData?.topTitle) ? TrustData.topTitle.filter(Boolean) : [] };
  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false, compress: true, info: { Title: "Transactions Report", Author: trust.name || "" } });
  const out = [];
  doc.on("data", (c) => out.push(c));
  const finished = new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(out))); doc.on("error", reject); });

  const F = fonts();
  doc.registerFont("R", F.R);
  doc.registerFont("B", F.B);

  // ── small drawing helpers ──
  const text = (s, x, y, { font = "R", size = 7.5, color = C.text, w, align = "left" } = {}) => {
    s = String(s ?? "");
    if (!s) return;
    doc.font(font).fontSize(size).fillColor(color);
    if (align !== "left" && w) {
      const tw = doc.widthOfString(s);
      x = align === "right" ? x + w - tw : x + (w - tw) / 2;
    }
    doc.text(s, x, y, { lineBreak: false });
  };
  const box = (x, y, w, h, fill, stroke, lw = 0.5, r = 0) => {
    if (r) doc.roundedRect(x, y, w, h, r); else doc.rect(x, y, w, h);
    if (fill && stroke) doc.lineWidth(lw).fillAndStroke(fill, stroke);
    else if (fill) doc.fill(fill);
    else if (stroke) doc.lineWidth(lw).stroke(stroke);
  };
  const image = (src, x, y, s) => {
    if (!src) return;
    try { doc.image(src, x, y, { fit: [s, s], align: "center", valign: "center" }); } catch { /* webp / broken image: skip */ }
  };

  // ── totals ──
  let cash = 0, online = 0;
  for (const t of transactions) (t.paymentMethod === "cash" ? (cash += t.amount || 0) : (online += t.amount || 0));
  const count = summary.totalTransactions ?? transactions.length;
  const total = summary.totalAmount ?? cash + online;
  const avg = count ? total / count : 0;

  const now = new Date();
  const genText = `जनरेट: ${generatedDate || now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })}`;
  const programName = trunc(programInfo?.name || programInfo?.hiname || "", 30);
  const filterText = (() => {
    const p = [];
    if (filters?.dateRange?.start && filters?.dateRange?.end) p.push(`तिथि: ${filters.dateRange.start} – ${filters.dateRange.end}`);
    if (filters?.paymentMethod && filters.paymentMethod !== "all") p.push(`विधि: ${filters.paymentMethod === "cash" ? "नकद" : "ऑनलाइन"}`);
    if (filters?.searchText) p.push(`खोज: "${filters.searchText}"`);
    return p.length ? `फ़िल्टर: ${p.join("  |  ")}` : "कोई फ़िल्टर नहीं — सभी लेन-देन";
  })();

  const pages = paginate(transactions.length);
  const N = pages.length;

  const frame = (pi) => {
    doc.addPage({ size: "A4", margin: 0 });
    box(20, 20, W - 40, H - 60, null, C.gold, 2);
    box(25, 25, W - 50, H - 70, null, C.gold, 0.8);
    // footer
    doc.moveTo(20, H - 32).lineTo(W - 20, H - 32).lineWidth(0.5).stroke(C.gold);
    text(genText, 20, H - 28, { size: 6.5, color: C.sub });
    text(`${trust.name || ""} © ${now.getFullYear()}`, 20, H - 28, { size: 6.5, color: C.sub, w: W - 40, align: "center" });
    text(`पृष्ठ ${pi + 1} / ${N}`, 20, H - 28, { size: 6.5, color: C.sub, w: W - 40, align: "right" });
  };

  const bigHeader = () => {
    let y = TOP;
    // top titles spread across
    const tt = trust.topTitle;
    if (tt.length) {
      const slot = CW / tt.length;
      tt.forEach((s, i) => text(trunc(s, 40), X0 + slot * i, y, { font: "B", color: C.maroon, w: slot, align: tt.length === 1 ? "center" : i === 0 ? "left" : i === tt.length - 1 ? "right" : "center" }));
    }
    y += 14;
    // logos + name block
    image(trust.logo, X0, y, 68);
    image(trust.RightLogo || trust.logo, X1 - 68, y, 68);
    const cx = X0 + 76, cw = CW - 152;
    text(trunc(trust.name, 40), cx, y, { font: "B", size: 18, color: C.maroon, w: cw, align: "center" });
    text(trunc(trust.cityState, 60), cx, y + 26, { font: "B", size: 10, color: "#222", w: cw, align: "center" });
    text(trunc(trust.address, 95), cx, y + 41, { size: 7.5, color: "#555", w: cw, align: "center" });
    text(trunc(trust.contact, 70), cx, y + 52, { font: "B", size: 8.5, color: "#222", w: cw, align: "center" });
    doc.font("B").fontSize(9);
    const bw = doc.widthOfString("लेन-देन रिपोर्ट") + 32;
    box(X0 + (CW - bw) / 2, y + 66, bw, 18, C.maroon, null, 0, 4);
    text("लेन-देन रिपोर्ट", X0 + (CW - bw) / 2, y + 68, { font: "B", size: 9, color: "#fff", w: bw, align: "center" });
    y += 92;
    // info bar
    box(X0, y, CW, 18, "#eef2ff");
    box(X0, y, 3, 18, C.maroon);
    const info = [["योजना:", programName || "-"], ["तिथि:", now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })], ["कुल लेन-देन:", inr.format(count)], ["कुल राशि:", fmt(total)]];
    const slot = (CW - 12) / info.length;
    info.forEach(([l, v], i) => {
      const x = X0 + 10 + slot * i;
      text(l, x, y + 4, { font: "B", color: C.maroon });
      doc.font("B").fontSize(7.5);
      text(v, x + doc.widthOfString(l) + 3, y + 4, { font: "B", color: C.navy });
    });
    y += 23;
    // filter strip
    box(X0, y, CW, 16, "#fffde7", "#fde68a", 0.7, 2);
    text(trunc(filterText, 140), X0 + 8, y + 3.5, { size: 7, color: "#78350f" });
    y += 22;
    // summary cards
    const cards = [
      ["कुल लेन-देन", inr.format(count), "#eff6ff", "#bfdbfe", C.blue],
      ["कुल राशि", fmt(total), "#dcfce7", "#86efac", C.green],
      ["नकद राशि", fmt(cash), "#fef9c3", "#fde68a", "#a16207"],
      ["ऑनलाइन राशि", fmt(online), "#ede9fe", "#c4b5fd", "#6d28d9"],
      ["औसत राशि", fmt(avg), "#fff7ed", "#fed7aa", "#c2410c"],
    ];
    const gap = 6, cwid = (CW - gap * (cards.length - 1)) / cards.length;
    cards.forEach(([l, v, bg, bd, fg], i) => {
      const x = X0 + i * (cwid + gap);
      box(x, y, cwid, 38, bg, bd, 0.7, 5);
      text(l, x, y + 5, { size: 6.5, color: C.sub, w: cwid, align: "center" });
      text(v, x, y + 16, { font: "B", size: i === 0 ? 13 : 11, color: fg, w: cwid, align: "center" });
    });
    return TOP + FIRST_HEAD_H;
  };

  const miniHeader = (pi) => {
    text(trunc(trust.name, 45), X0, TOP, { font: "B", size: 9, color: C.maroon });
    text(`लेन-देन रिपोर्ट · ${programName} · पृष्ठ ${pi + 1}/${N}`, X0, TOP + 1.5, { font: "B", color: C.navy, w: CW, align: "right" });
    doc.moveTo(X0, TOP + 15).lineTo(X1, TOP + 15).lineWidth(0.8).stroke(C.gold);
    return TOP + MINI_HEAD_H;
  };

  const tableHead = (y) => {
    box(X0, y, CW, HEAD_H, C.navy);
    for (const c of COL) text(c.label, c.x + 3, y + 6, { font: "B", size: 7, color: "#fff", w: c.w - 6, align: c.align });
    return y + HEAD_H;
  };

  const row = (t, idx, y) => {
    if (idx % 2 === 0) box(X0, y, CW, ROW_H, C.rowEven);
    const ty = y + 4, sy = y + 13.5;
    text(idx + 1, col.no.x, ty + 3, { size: 7, color: C.sub, w: col.no.w, align: "center" });
    text(trunc(t.transactionNumber, 22), col.trx.x + 3, ty + 3.5, { size: 6.5, color: "#374151" });
    text(fmtD(t.paymentDate), col.date.x, ty + 3, { w: col.date.w, align: "center" });
    text(trunc(t.payerName, 24), col.payer.x + 3, ty, { font: "B" });
    if (t.payerRegistrationNumber) text(t.payerRegistrationNumber, col.payer.x + 3, sy, { size: 6.5, color: C.sub });
    text(trunc(t.marriageMemberName, 24), col.benef.x + 3, ty, { font: "B" });
    if (t.marriageRegistrationNumber) text(t.marriageRegistrationNumber, col.benef.x + 3, sy, { size: 6.5, color: C.sub });
    text(fmt(t.amount), col.amount.x, ty + 3, { font: "B", size: 8, color: C.green, w: col.amount.w - 4, align: "right" });
    const cashRow = t.paymentMethod === "cash";
    text(cashRow ? "नकद" : "ऑनलाइन", col.method.x, ty + 3, { font: "B", size: 7, color: cashRow ? C.green : C.blue, w: col.method.w, align: "center" });
    const ref = trunc(t.onlineReference, 20), note = trunc(t.note, 22);
    if (ref) text(ref, col.ref.x + 3, ty, { size: 7, color: "#374151" });
    if (note) text(note, col.ref.x + 3, ref ? sy : ty, { size: 6.5, color: C.sub });
    if (!ref && !note) text("—", col.ref.x + 3, ty + 3, { size: 7, color: C.sub });
    doc.moveTo(X0, y + ROW_H).lineTo(X1, y + ROW_H).lineWidth(0.4).stroke(C.border);
  };

  pages.forEach(([from, to], pi) => {
    frame(pi);
    let y = pi === 0 ? bigHeader() : miniHeader(pi);
    const last = pi === N - 1;
    const tableTop = y;
    if (to > from) y = tableHead(y);
    for (let i = from; i < to; i++, y += ROW_H) row(transactions[i], i, y);
    if (to > from) {
      // column rules + outline, once per page
      doc.lineWidth(0.4);
      for (const c of COL.slice(1)) doc.moveTo(c.x, tableTop + HEAD_H).lineTo(c.x, y).stroke(C.border);
      box(X0, tableTop, CW, y - tableTop, null, C.border, 0.6);
    }
    if (last) {
      box(X0, y, CW, TOTAL_H, C.navy);
      text("कुल योग :", X0, y + 6, { font: "B", size: 8, color: "#fff", w: col.amount.x - X0 - 6, align: "right" });
      text(fmt(total), col.amount.x, y + 6, { font: "B", size: 8, color: "#86efac", w: col.amount.w - 4, align: "right" });
      text(`${inr.format(count)} entries`, col.method.x, y + 6.5, { size: 7, color: "#c7c9d9", w: col.method.w + col.ref.w, align: "center" });
      y += TOTAL_H + 8;
      box(X0, y, CW, 24, "#fffde7", "#fde68a", 0.7, 4);
      text("यह दान स्वेच्छिक रूप से दिया गया है और किसी भी कारणवश इसकी वापसी नहीं की जाएगी।", X0, y + 7, { font: "B", size: 8, color: "#78350f", w: CW, align: "center" });
    }
  });

  doc.end();
  return finished;
}
