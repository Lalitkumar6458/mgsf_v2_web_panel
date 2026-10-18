// One generic A4 list PDF, drawn with pdfkit (same look as the transactions report):
// trust header → title → info strip → summary cards → table (repeats its head on every page)
// → total row → note.  Used by the mobile app: member statement, agent's due / paid / fee lists,
// one closing's payers, one closing group's members.
//
//   buildListReport({
//     TrustData, title, subtitle, info: [[label, value]], cards: [[label, value, tone]],
//     columns: [{ key, label, w, align }], rows: [{ key: value }], total: { key: value }, note,
//   })
import PDFDocument from "pdfkit";
import NotoSansDevanagari from "../../app/api/helperfile/static/font/NotoSansDevanagari.js";
import NotoSansDevanagariBold from "../../app/api/helperfile/static/font/NotoSansDevanagariBold.js";

const fontBuf = (dataUri) => Buffer.from(String(dataUri).split(",")[1] || "", "base64");
let FONTS = null;
const fonts = () => (FONTS ??= { R: fontBuf(NotoSansDevanagari), B: fontBuf(NotoSansDevanagariBold) });

const C = {
  maroon: "#8B0000", navy: "#1a1a4e", gold: "#c9a227", rowEven: "#fdf8f0", green: "#15803d", red: "#b91c1c",
  amber: "#a16207", blue: "#1d4ed8", border: "#e5e7eb", sub: "#9ca3af", text: "#262626",
};
const TONES = {
  green: ["#dcfce7", "#86efac", C.green], red: ["#fee2e2", "#fca5a5", C.red], amber: ["#fef9c3", "#fde68a", C.amber],
  blue: ["#eff6ff", "#bfdbfe", C.blue], brand: ["#fff7ed", "#fed7aa", "#c2410c"],
};

const W = 595.28, H = 841.89;
const X0 = 32, X1 = W - 32, CW = X1 - X0;
const TOP = 32, BOTTOM = H - 48;
const ROW_H = 22, HEAD_H = 22, TOTAL_H = 22;

const trunc = (s, n) => { s = String(s ?? "").trim(); return !s ? "" : s.length > n ? `${s.slice(0, n - 1)}…` : s; };

export function buildListReport({
  TrustData = {}, title = "सूची", subtitle = "", info = [], cards = [], columns = [], rows = [], total = null, note = "", generatedDate,
}) {
  const trust = { ...TrustData, topTitle: Array.isArray(TrustData?.topTitle) ? TrustData.topTitle.filter(Boolean) : [] };
  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false, compress: true, info: { Title: title, Author: trust.name || "" } });
  const out = [];
  doc.on("data", (c) => out.push(c));
  const finished = new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(out))); doc.on("error", reject); });
  const F = fonts();
  doc.registerFont("R", F.R);
  doc.registerFont("B", F.B);

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
    try { doc.image(src, x, y, { fit: [s, s], align: "center", valign: "center" }); } catch { /* broken / webp image */ }
  };
  // fit a string into a column width (pdfkit measures; cut by characters until it fits)
  const fit = (s, w, font = "R", size = 7.5) => {
    s = String(s ?? "");
    doc.font(font).fontSize(size);
    if (doc.widthOfString(s) <= w) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (doc.widthOfString(`${s.slice(0, mid)}…`) <= w) lo = mid; else hi = mid - 1;
    }
    return `${s.slice(0, lo)}…`;
  };

  // columns scaled to the page width
  const sumW = columns.reduce((a, c) => a + (c.w || 60), 0) || 1;
  let cx = X0;
  const COL = columns.map((c) => { const o = { ...c, x: cx, w: ((c.w || 60) * CW) / sumW, align: c.align || "left" }; cx += o.w; return o; });

  const now = new Date();
  const genText = `जनरेट: ${generatedDate || now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })}`;
  let page = 0;

  const frame = () => {
    doc.addPage({ size: "A4", margin: 0 });
    page += 1;
    box(20, 20, W - 40, H - 60, null, C.gold, 2);
    box(25, 25, W - 50, H - 70, null, C.gold, 0.8);
    doc.moveTo(20, H - 32).lineTo(W - 20, H - 32).lineWidth(0.5).stroke(C.gold);
    text(genText, 20, H - 28, { size: 6.5, color: C.sub });
    text(`${trust.name || ""} © ${now.getFullYear()}`, 20, H - 28, { size: 6.5, color: C.sub, w: W - 40, align: "center" });
    text(`पृष्ठ ${page}`, 20, H - 28, { size: 6.5, color: C.sub, w: W - 40, align: "right" });
  };

  const bigHeader = () => {
    let y = TOP;
    const tt = trust.topTitle;
    if (tt.length) {
      const slot = CW / tt.length;
      tt.forEach((s, i) => text(trunc(s, 40), X0 + slot * i, y, { font: "B", color: C.maroon, w: slot, align: tt.length === 1 ? "center" : i === 0 ? "left" : i === tt.length - 1 ? "right" : "center" }));
    }
    y += 14;
    image(trust.logo, X0, y, 60);
    image(trust.RightLogo || trust.logo, X1 - 60, y, 60);
    const bx = X0 + 68, bw = CW - 136;
    text(fit(trust.name, bw, "B", 17), bx, y, { font: "B", size: 17, color: C.maroon, w: bw, align: "center" });
    text(fit(trust.cityState, bw, "B", 9.5), bx, y + 24, { font: "B", size: 9.5, color: "#222", w: bw, align: "center" });
    text(fit(trust.address, bw), bx, y + 38, { size: 7.5, color: "#555", w: bw, align: "center" });
    text(fit(trust.contact, bw, "B", 8.5), bx, y + 49, { font: "B", size: 8.5, color: "#222", w: bw, align: "center" });
    doc.font("B").fontSize(10);
    const tw = Math.min(doc.widthOfString(title) + 32, CW);
    box(X0 + (CW - tw) / 2, y + 63, tw, 19, C.maroon, null, 0, 4);
    text(fit(title, tw - 12, "B", 10), X0 + (CW - tw) / 2, y + 65.5, { font: "B", size: 10, color: "#fff", w: tw, align: "center" });
    y += 88;
    if (subtitle) {
      text(fit(subtitle, CW, "B", 9), X0, y, { font: "B", size: 9, color: C.navy, w: CW, align: "center" });
      y += 16;
    }
    if (info.length) {
      box(X0, y, CW, 18, "#eef2ff");
      box(X0, y, 3, 18, C.maroon);
      const slot = (CW - 12) / info.length;
      info.forEach(([l, v], i) => {
        const x = X0 + 10 + slot * i;
        text(l, x, y + 4, { font: "B", color: C.maroon });
        doc.font("B").fontSize(7.5);
        const lw = doc.widthOfString(String(l)) + 3;
        text(fit(v, slot - lw - 6, "B"), x + lw, y + 4, { font: "B", color: C.navy });
      });
      y += 24;
    }
    if (cards.length) {
      const gap = 6, cw = (CW - gap * (cards.length - 1)) / cards.length;
      cards.forEach(([l, v, tone], i) => {
        const [bg, bd, fg] = TONES[tone] || TONES.blue;
        const x = X0 + i * (cw + gap);
        box(x, y, cw, 38, bg, bd, 0.7, 5);
        text(fit(l, cw - 6, "R", 6.5), x, y + 5, { size: 6.5, color: C.sub, w: cw, align: "center" });
        text(fit(v, cw - 6, "B", 11), x, y + 16, { font: "B", size: 11, color: fg, w: cw, align: "center" });
      });
      y += 46;
    }
    return y;
  };

  const miniHeader = () => {
    text(fit(trust.name, CW / 2, "B", 9), X0, TOP, { font: "B", size: 9, color: C.maroon });
    text(fit(`${title}${subtitle ? ` · ${subtitle}` : ""}`, CW / 2, "B"), X0 + CW / 2, TOP + 1.5, { font: "B", color: C.navy, w: CW / 2, align: "right" });
    doc.moveTo(X0, TOP + 15).lineTo(X1, TOP + 15).lineWidth(0.8).stroke(C.gold);
    return TOP + 22;
  };

  const tableHead = (y) => {
    box(X0, y, CW, HEAD_H, C.navy);
    for (const c of COL) text(fit(c.label, c.w - 6, "B", 7), c.x + 3, y + 6, { font: "B", size: 7, color: "#fff", w: c.w - 6, align: c.align });
    return y + HEAD_H;
  };

  const drawRow = (r, i, y, isTotal = false) => {
    if (isTotal) box(X0, y, CW, TOTAL_H, "#fff7ed", C.gold, 0.8);
    else {
      if (i % 2) box(X0, y, CW, ROW_H, C.rowEven);
      doc.moveTo(X0, y + ROW_H).lineTo(X1, y + ROW_H).lineWidth(0.3).stroke(C.border);
    }
    for (const c of COL) {
      const v = r[c.key];
      if (v === undefined || v === null || v === "") continue;
      const color = r[`${c.key}Color`] || (isTotal ? C.maroon : C.text);
      const font = isTotal || c.bold ? "B" : "R";
      text(fit(v, c.w - 6, font), c.x + 3, y + 7, { font, color, w: c.w - 6, align: c.align });
    }
    return y + (isTotal ? TOTAL_H : ROW_H);
  };

  frame();
  let y = tableHead(bigHeader());
  if (!rows.length) {
    text("कोई रिकॉर्ड नहीं", X0, y + 14, { font: "B", size: 10, color: C.sub, w: CW, align: "center" });
    y += 40;
  }
  rows.forEach((r, i) => {
    if (y + ROW_H > BOTTOM) { frame(); y = tableHead(miniHeader()); }
    y = drawRow(r, i, y);
  });
  if (total) {
    if (y + TOTAL_H > BOTTOM) { frame(); y = tableHead(miniHeader()); }
    y = drawRow(total, 0, y, true);
  }
  if (note) {
    if (y + 30 > BOTTOM) { frame(); y = miniHeader(); }
    box(X0, y + 8, CW, 22, "#fffde7", "#fde68a", 0.7, 3);
    text(fit(note, CW - 16, "R", 7), X0 + 8, y + 15, { size: 7, color: "#78350f" });
  }
  doc.end();
  return finished;
}
