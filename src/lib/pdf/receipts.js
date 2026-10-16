// रसीद (receipt) PDFs, drawn directly with pdfkit — replaces the react-pdf VivahMemoPDF for runs.
//
//   • Pending → "बकाया सूचना" (what is due, last date, optional UPI QR with the amount filled in)
//   • Paid    → "भुगतान रसीद" (amount in words, stamp + signature, "भुगतान प्राप्त" watermark,
//               verify QR that opens /verify/r/<code>)
//   • Layouts: A5 (as before), A4, two A5 on one A4 sheet, 80 mm thermal slip
//   • Themes:  classic navy, kesariya, hara, royal, black & white
// Settings: lib/receiptSettings.js (Settings → Rasid). Runs in the PDF worker thread.
//
// One receipt per member; its rows are the closings (dues) of the wanted status. A member whose
// rows do not fit on one page keeps the same रसीद न. and continues on the next page (पृष्ठ 2/2).
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import NotoSansDevanagari from "../../app/api/helperfile/static/font/NotoSansDevanagari.js";
import NotoSansDevanagariBold from "../../app/api/helperfile/static/font/NotoSansDevanagariBold.js";
import { normalizeReceiptSettings, themeOf, layoutOf, upiLink } from "../receiptSettings.js";
import { rupeesInWords } from "../amountWords.js";
import { getDistrictLabel, getStateLabel } from "../staticData.js";
import { sortByDate, formatShortDate } from "../dateUtils.js";

const fontBuf = (dataUri) => Buffer.from(String(dataUri).split(",")[1] || "", "base64");
let FONTS = null;
const fonts = () => (FONTS ??= { R: fontBuf(NotoSansDevanagari), B: fontBuf(NotoSansDevanagariBold) });

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const money = (n) => `₹${inr.format(Math.round(Number(n) || 0))}`;
const clean = (v) => String(v ?? "").trim();

export const formatReceiptNo = (seq, prefix = "") => `${prefix || ""}${String(seq).padStart(4, "0")}`;

/**
 * Which members get a receipt, with which number — shared by the PDF and the receipt register
 * (so the number printed is the number stored). Members with no row of the wanted status are
 * skipped and do not use up a number.
 */
export function planReceipts(members = [], { status = "pending", receiptStartNo = 1, receiptPrefix = "" } = {}) {
  const want = status === "paid" ? "paid" : "pending";
  let seq = Number(receiptStartNo) > 0 ? Math.floor(Number(receiptStartNo)) : 1;
  const out = [];
  for (const m of members) {
    const rows = sortByDate((m.marriages || []).filter((x) => x.status === want), (x) => x.marriageDate, "asc");
    if (!rows.length) continue;
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    out.push({ member: m, rows, total, receiptNo: formatReceiptNo(seq++, receiptPrefix) });
  }
  return out;
}

/** Hindi place labels for a member / closing row */
const place = (village, district, state) => {
  const st = getStateLabel(state) || "";
  const di = district ? getDistrictLabel(district, state) || "" : "";
  return [clean(village), [di, st].filter(Boolean).join(" - ")].filter(Boolean).join(", ");
};

const rowName = (r, holderLabel) => {
  const head = r.closingFatherName ? `${clean(r.closingMemberName)} / ${clean(r.closingFatherName)}` : clean(r.closingMemberName);
  const where = [clean(r.closingVillage), getStateLabel(r.closingState) || ""].filter(Boolean).join(" ");
  const holder = r.closingGuardian ? `(${holderLabel}: ${[r.closingGuardian, r.closingGuardianRelation].filter(Boolean).join(" ")})` : "";
  return [head, where, holder].filter(Boolean).join(" ");
};

// ─── geometry ────────────────────────────────────────────────────────────────
const A5 = [419.53, 595.28];
const A4 = [595.28, 841.89];
const THERMAL_W = 226.77; // 80 mm

/**
 * @param {object} p
 *   members, programInfo, TrustData (images as data URIs), paymentStatus, receiptStartNo, receiptPrefix,
 *   settings (receipt settings; signImg as data URI), verify: { baseUrl, codes: { [receiptNo]: code } },
 *   agentInfo, printDate ("DD-MM-YYYY")
 * @returns {Promise<Buffer>}
 */
export function buildReceipts(p) {
  const S = normalizeReceiptSettings(p.settings);
  // images were resolved to data URIs by the server — normalize drops them, put them back
  const signImg = typeof p.settings?.signImg === "string" && p.settings.signImg.startsWith("data:") ? p.settings.signImg : null;
  const T = themeOf(S.theme);
  const L = layoutOf(S.layout);
  const status = p.paymentStatus === "paid" ? "paid" : "pending";
  const paid = status === "paid";
  const trust = { ...(p.TrustData || {}) };
  const program = p.programInfo || {};
  const holderLabel = program.isMamera ? "हकदार" : "वारिसदार";
  const printDate = p.printDate || formatShortDate(new Date());
  const dueDate = !paid && S.dueDays ? formatShortDate(new Date(Date.now() + S.dueDays * 86400000)) : "";
  const verify = p.verify || {};
  const title = paid ? S.paidTitle : S.pendingTitle;
  const plan = planReceipts(p.members, { status, receiptStartNo: p.receiptStartNo, receiptPrefix: p.receiptPrefix });

  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, compress: true, info: { Title: `${title} — ${trust.name || ""}`, Author: trust.name || "" } });
  const out = [];
  doc.on("data", (c) => out.push(c));
  const finished = new Promise((res, rej) => { doc.on("end", () => res(Buffer.concat(out))); doc.on("error", rej); });
  const F = fonts();
  doc.registerFont("R", F.R);
  doc.registerFont("B", F.B);

  // ── helpers ──
  const fit = (s, w, size, font = "R") => {
    s = clean(s);
    if (!s) return "";
    doc.font(font).fontSize(size);
    if (doc.widthOfString(s) <= w) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (doc.widthOfString(s.slice(0, mid) + "…") <= w) lo = mid; else hi = mid - 1; }
    return s.slice(0, lo) + "…";
  };
  const text = (s, x, y, { font = "R", size = 8, color = "#222", w, align = "left", fitTo } = {}) => {
    s = clean(s);
    if (!s) return;
    if (fitTo) s = fit(s, fitTo, size, font);
    doc.font(font).fontSize(size).fillColor(color);
    if (w && align !== "left") {
      const tw = doc.widthOfString(s);
      x = align === "right" ? x + w - tw : x + (w - tw) / 2;
    }
    doc.text(s, x, y, { lineBreak: false });
  };
  const para = (s, x, y, w, { font = "R", size = 7, color = "#444", align = "center", maxLines = 2 } = {}) => {
    s = clean(s);
    if (!s) return 0;
    doc.font(font).fontSize(size).fillColor(color);
    const h = Math.min(doc.heightOfString(s, { width: w }), size * 1.35 * maxLines);
    doc.text(s, x, y, { width: w, align, height: h, ellipsis: true });
    return h;
  };
  const rect = (x, y, w, h, { fill, stroke, lw = 0.6, r = 0 } = {}) => {
    if (r) doc.roundedRect(x, y, w, h, r); else doc.rect(x, y, w, h);
    if (fill && stroke) doc.lineWidth(lw).fillAndStroke(fill, stroke);
    else if (fill) doc.fill(fill);
    else if (stroke) doc.lineWidth(lw).stroke(stroke);
  };
  const image = (src, x, y, w, h) => {
    if (!src) return false;
    try { doc.image(src, x, y, { fit: [w, h], align: "center", valign: "center" }); return true; } catch { return false; }
  };
  const qr = (data, x, y, size, color = "#111") => {
    let q;
    try { q = QRCode.create(data, { errorCorrectionLevel: "M" }); } catch { return; }
    const n = q.modules.size, cell = size / n, bits = q.modules.data;
    rect(x - 3, y - 3, size + 6, size + 6, { fill: "#ffffff" });
    doc.fillColor(color);
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!bits[r * n + c]) { c++; continue; }
        let e = c;
        while (e < n && bits[r * n + e]) e++;
        doc.rect(x + c * cell, y + r * cell, (e - c) * cell + 0.15, cell + 0.15);
        c = e;
      }
    }
    doc.fill(color);
  };

  // ── one receipt page inside a slot (x, y, w, h) — A5 / A4 / half of A4 ──
  const drawSlot = (sx, sy, sw, sh, rec, rows, pi, pages, firstSr, k) => {
    const last = pi === pages - 1;
    const m = rec.member;
    const pad = 10 * k, X0 = sx + pad + 6 * k, X1 = sx + sw - pad - 6 * k, CW = X1 - X0;
    rect(sx, sy, sw, sh, { fill: T.bg });
    rect(sx + pad, sy + pad, sw - 2 * pad, sh - 2 * pad, { stroke: T.primary, lw: 1.6 * k });
    rect(sx + pad + 3 * k, sy + pad + 3 * k, sw - 2 * pad - 6 * k, sh - 2 * pad - 6 * k, { stroke: T.primary, lw: 0.5 * k });

    // watermark (paid)
    if (paid && S.showWatermark) {
      doc.save();
      doc.rotate(-28, { origin: [sx + sw / 2, sy + sh / 2] });
      doc.opacity(0.07);
      text("भुगतान प्राप्त", sx, sy + sh / 2 - 22 * k, { font: "B", size: 46 * k, color: T.accent, w: sw, align: "center" });
      doc.restore();
      doc.opacity(1);
    }

    let y = sy + pad + 9 * k;
    // header
    if (trust.headerMode === "image" && trust.headerImg) {
      image(trust.headerImg, X0, y, CW, 64 * k);
      y += 68 * k;
    } else {
      const tt = (trust.topTitle || []).filter(Boolean);
      if (tt.length) {
        const slot = CW / tt.length;
        tt.forEach((s, i) => text(s, X0 + slot * i, y, { font: "B", size: 6.5 * k, color: T.accent, w: slot, align: tt.length === 1 ? "center" : i === 0 ? "left" : i === tt.length - 1 ? "right" : "center", fitTo: slot }));
        y += 10 * k;
      }
      const lg = 50 * k;
      image(trust.logo, X0, y, lg, lg);
      image(trust.RightLogo || trust.logo, X1 - lg, y, lg, lg);
      const cx = X0 + lg + 4 * k, cw = CW - 2 * lg - 8 * k;
      text(trust.name, cx, y + 1 * k, { font: "B", size: 14 * k, color: T.accent, w: cw, align: "center", fitTo: cw });
      text(trust.cityState, cx, y + 21 * k, { font: "B", size: 7.5 * k, color: "#222", w: cw, align: "center", fitTo: cw });
      text(trust.address, cx, y + 31 * k, { size: 6.8 * k, color: "#444", w: cw, align: "center", fitTo: cw });
      text(trust.contact ? `मो. ${trust.contact}` : "", cx, y + 41 * k, { font: "B", size: 7 * k, color: "#222", w: cw, align: "center", fitTo: cw });
      y += lg + 4 * k;
    }
    doc.moveTo(X0, y).lineTo(X1, y).lineWidth(0.6 * k).stroke(T.primary);
    y += 6 * k;

    // title pill
    doc.font("B").fontSize(10 * k);
    const tw = doc.widthOfString(title) + 30 * k, th = 17 * k;
    rect(X0 + (CW - tw) / 2, y, tw, th, { fill: T.primary, r: th / 2 });
    text(title, X0 + (CW - tw) / 2, y + 3 * k, { font: "B", size: 10 * k, color: "#fff", w: tw, align: "center" });
    if (paid) {
      rect(X1 - 38 * k, y + 2 * k, 38 * k, 13 * k, { stroke: "#15803d", lw: 1 * k, r: 2 * k });
      text("PAID", X1 - 38 * k, y + 3.5 * k, { font: "B", size: 7.5 * k, color: "#15803d", w: 38 * k, align: "center" });
    }
    y += th + 7 * k;

    // meta (two columns)
    const lh = 11.5 * k, fs = 7.4 * k, half = CW / 2;
    const left = [
      ["रसीद न.", rec.receiptNo],
      ["सदस्य क्रमांक", m.applicationNumber || m.registrationNumber || "-"],
      ["नाम", [m.displayName, m.fatherName].filter(Boolean).join(" / ") || "-"],
      ["निवास", [m.currentAddress, m.village].filter(Boolean).join(", ") || "-"],
      ["किस्त", m.payAmount ? money(m.payAmount) : "-"],
    ];
    const right = [
      ["दिनांक", printDate],
      ["मोबाइल", m.phone || "-"],
      [`${holderLabel}`, [m.guardian, m.guardianRelation].filter(Boolean).join(" ") || "-"],
      ["जिला / राज्य", place("", m.district, m.state) || "-"],
      ...(dueDate ? [["अंतिम तिथि", dueDate]] : []),
    ];
    const meta = (list, x, w) => list.forEach(([l, v], i) => {
      text(`${l}:`, x, y + i * lh, { font: "B", size: fs, color: T.primary });
      doc.font("B").fontSize(fs);
      const lw = Math.max(doc.widthOfString(`${l}:`) + 4 * k, 46 * k);
      const isDue = l === "अंतिम तिथि";
      text(v, x + lw, y + i * lh, { font: "B", size: fs, color: isDue ? T.accent : "#111", fitTo: w - lw - 6 * k });
    });
    meta(left, X0, half);
    meta(right, X0 + half + 6 * k, half - 6 * k);
    y += Math.max(left.length, right.length) * lh + 5 * k;

    // table
    const cols = [
      ["क्र.", 20], ["कोड न.", 46], ["नाम", 0], ["मोबाइल", 54], ["दिनांक", 46], ["राशि", 42],
    ].map(([label, w]) => ({ label, w: w * k }));
    const fixed = cols.reduce((s, c) => s + c.w, 0);
    cols[2].w = CW - fixed;
    let cx2 = X0;
    for (const c of cols) { c.x = cx2; cx2 += c.w; }
    const headH = 15 * k;
    // reserve the bottom block first, rows get what is left
    const footY = sy + sh - pad - 15 * k;
    const bottomTop = footY - (trust.founder ? 16 * k : 2 * k) - (last ? 98 : 22) * k; // totals, QR, sign
    const rowsArea = bottomTop - (y + headH);
    const rowH = Math.max(13 * k, Math.min(24 * k, rowsArea / L.rows));
    rect(X0, y, CW, headH, { fill: T.primary });
    for (const c of cols) text(c.label, c.x, y + 3.5 * k, { font: "B", size: 7 * k, color: "#fff", w: c.w, align: "center" });
    y += headH;
    const tableTop = y;
    const nRows = Math.min(L.rows, Math.max(rows.length, Math.floor(rowsArea / rowH)));
    for (let i = 0; i < nRows; i++) {
      const r = rows[i];
      if (i % 2 === 0) rect(X0, y, CW, rowH, { fill: T.row });
      if (r) {
        const ty = y + (rowH - 7 * k) / 2 - 1 * k;
        text(String(firstSr + i), cols[0].x, ty, { size: 7 * k, w: cols[0].w, align: "center" });
        text(r.closingRegNo || "-", cols[1].x, ty, { size: 7 * k, w: cols[1].w, align: "center", fitTo: cols[1].w - 4 * k });
        text(rowName(r, holderLabel), cols[2].x + 3 * k, ty, { size: 6.8 * k, fitTo: cols[2].w - 6 * k });
        text(r.closingPhone || "-", cols[3].x, ty, { size: 6.8 * k, w: cols[3].w, align: "center", fitTo: cols[3].w - 4 * k });
        text(formatShortDate(r.marriageDate, "-"), cols[4].x, ty, { size: 6.8 * k, w: cols[4].w, align: "center" });
        text(money(r.amount), cols[5].x, ty, { font: "B", size: 7 * k, color: T.accent, w: cols[5].w - 4 * k, align: "right" });
      }
      doc.moveTo(X0, y + rowH).lineTo(X1, y + rowH).lineWidth(0.35 * k).stroke("#9aa3af");
      y += rowH;
    }
    doc.lineWidth(0.4 * k);
    for (const c of cols.slice(1)) doc.moveTo(c.x, tableTop).lineTo(c.x, y).stroke("#9aa3af");
    rect(X0, tableTop - headH, CW, y - tableTop + headH, { stroke: T.primary, lw: 0.8 * k });
    y += 6 * k;

    if (!last) {
      text("शेष प्रविष्टियाँ अगले पृष्ठ पर…", X0, y, { size: 7.5 * k, color: "#555", w: CW, align: "center" });
    } else {
      // amount box + words
      doc.font("B").fontSize(12 * k);
      const amt = money(rec.total);
      const bw = Math.max(70 * k, doc.widthOfString(amt) + 30 * k), bh = 22 * k;
      rect(X0, y, bw, bh, { fill: "#fff", stroke: T.accent, lw: 1 * k, r: 3 * k });
      rect(X0, y, 16 * k, bh, { fill: T.accent, r: 3 * k });
      text("₹", X0, y + 5 * k, { font: "B", size: 9 * k, color: "#fff", w: 16 * k, align: "center" });
      text(amt, X0 + 18 * k, y + 4 * k, { font: "B", size: 12 * k, color: T.accent, w: bw - 22 * k, align: "center" });
      text(`${rows.length + firstSr - 1} प्रविष्टियाँ`, X0 + bw + 6 * k, y + 2 * k, { size: 6.8 * k, color: "#555" });
      if (S.showAmountWords) text(rupeesInWords(rec.total), X0 + bw + 6 * k, y + 11 * k, { font: "B", size: 7 * k, color: "#222", fitTo: CW * 0.55 });
      // agent (right)
      const agentName = m.agentName || p.agentInfo?.displayName || "";
      if (agentName) {
        text(`प्रतिनियुक्त: ${agentName}`, X0, y + 1 * k, { font: "B", size: 7.2 * k, color: T.accent, w: CW, align: "right", fitTo: CW * 0.4 });
        text(m.agentPhone || p.agentInfo?.phone || "", X0, y + 11 * k, { font: "B", size: 7 * k, color: T.accent, w: CW, align: "right" });
      }
      y += bh + 6 * k;

      // QR (left) · note (middle) · stamp + sign (right)
      const qs = 50 * k;
      let qrCaption = "", qrData = "";
      if (paid && S.showVerifyQr && verify.baseUrl && verify.codes?.[rec.receiptNo]) {
        qrData = `${verify.baseUrl.replace(/\/$/, "")}/verify/r/${verify.codes[rec.receiptNo]}`;
        qrCaption = "स्कैन कर रसीद जाँचें";
      } else if (!paid && S.showUpiQr && S.upiId) {
        qrData = upiLink({ upiId: S.upiId, upiName: S.upiName || trust.name, amount: rec.total, note: `${m.registrationNumber || ""} ${title}` });
        qrCaption = "स्कैन कर भुगतान करें";
      }
      let noteX = X0, noteW = CW * 0.6;
      if (qrData) {
        qr(qrData, X0 + 3 * k, y + 3 * k, qs, "#111");
        text(qrCaption, X0 - 4 * k, y + qs + 7 * k, { font: "B", size: 6 * k, color: T.primary, w: qs + 14 * k, align: "center" });
        if (!paid) text(S.upiId, X0 - 6 * k, y + qs + 15 * k, { size: 5.6 * k, color: "#555", w: qs + 18 * k, align: "center", fitTo: qs + 18 * k });
        noteX = X0 + qs + 14 * k; noteW = CW - qs - 14 * k - 100 * k;
      } else {
        noteW = CW - 100 * k;
      }
      para(paid ? S.paidNote : S.pendingNote, noteX, y + 8 * k, noteW, { size: 6.8 * k, color: "#444" });
      // signature block
      const sbx = X1 - 92 * k;
      if (S.showStamp && trust.stampImg) image(trust.stampImg, sbx, y, 40 * k, 40 * k);
      if (signImg) image(signImg, sbx + 26 * k, y + 8 * k, 66 * k, 30 * k);
      text(trust.signatoryName, sbx, y + 42 * k, { font: "B", size: 7.5 * k, color: "#111", w: 92 * k, align: "right", fitTo: 92 * k });
      text("हस्ताक्षर", sbx, y + 52 * k, { size: 6.5 * k, color: "#444", w: 92 * k, align: "right" });
    }

    // founder bar + footer
    if (trust.founder) {
      rect(X0, footY - 14 * k, CW, 12 * k, { fill: T.soft });
      text(`संस्थापक : ${trust.founder}`, X0, footY - 11.5 * k, { font: "B", size: 6.8 * k, color: T.accent, w: CW, align: "center", fitTo: CW - 8 * k });
    }
    text(`रसीद न. ${rec.receiptNo}`, X0, footY, { font: "B", size: 6.8 * k, color: "#111" });
    text(program.name ? `${program.name}` : "", X0, footY, { size: 6.5 * k, color: "#666", w: CW, align: "center", fitTo: CW / 2 });
    text(`पृष्ठ ${pi + 1}/${pages}`, X0, footY, { font: "B", size: 6.8 * k, color: "#111", w: CW, align: "right" });
  };

  // ── 80 mm thermal slip: one long page per receipt ──
  const drawThermal = (rec) => {
    const m = rec.member;
    const W = THERMAL_W, X0 = 10, CW = W - 20;
    const qrOn = (paid && S.showVerifyQr && verify.baseUrl && verify.codes?.[rec.receiptNo]) || (!paid && S.showUpiQr && S.upiId);
    const H = 210 + rec.rows.length * 26 + (S.showAmountWords ? 12 : 0) + (qrOn ? 100 : 0) + (dueDate ? 10 : 0) + 40;
    doc.addPage({ size: [W, H], margin: 0 });
    let y = 10;
    if (image(trust.logo, W / 2 - 18, y, 36, 36)) y += 40;
    text(trust.name, X0, y, { font: "B", size: 10.5, color: "#000", w: CW, align: "center", fitTo: CW }); y += 15;
    text(trust.cityState, X0, y, { size: 7, color: "#000", w: CW, align: "center", fitTo: CW }); y += 10;
    if (trust.contact) { text(`मो. ${trust.contact}`, X0, y, { size: 7, color: "#000", w: CW, align: "center", fitTo: CW }); y += 10; }
    const dash = () => { doc.moveTo(X0, y).lineTo(X1t, y).dash(2, { space: 2 }).lineWidth(0.6).stroke("#000"); doc.undash(); y += 5; };
    const X1t = W - 10;
    dash();
    text(title + (paid ? "  (PAID)" : ""), X0, y, { font: "B", size: 10, color: "#000", w: CW, align: "center" }); y += 15;
    const line = (l, v, bold) => { text(`${l}:`, X0, y, { font: "B", size: 7.4, color: "#000" }); text(v, X0 + 58, y, { font: bold ? "B" : "R", size: 7.4, color: "#000", fitTo: CW - 58 }); y += 10.5; };
    line("रसीद न.", rec.receiptNo, true);
    line("दिनांक", printDate);
    line("सदस्य", `${m.displayName || ""}${m.registrationNumber ? ` (${m.registrationNumber})` : ""}`, true);
    if (m.fatherName) line("पिता", m.fatherName);
    if (m.village) line("गाँव", m.village);
    if (m.phone) line("मोबाइल", m.phone);
    if (dueDate) line("अंतिम तिथि", dueDate, true);
    dash();
    rec.rows.forEach((r, i) => {
      text(`${i + 1}. ${clean(r.closingMemberName)}${r.closingFatherName ? ` / ${clean(r.closingFatherName)}` : ""}`, X0, y, { font: "B", size: 7.4, color: "#000", fitTo: CW - 45 });
      text(money(r.amount), X0, y, { font: "B", size: 7.6, color: "#000", w: CW, align: "right" });
      y += 10;
      text(`${r.closingRegNo || "-"} · ${clean(r.closingVillage)} · ${formatShortDate(r.marriageDate, "-")}`, X0 + 9, y, { size: 6.6, color: "#333", fitTo: CW - 9 });
      y += 16;
    });
    dash();
    text("कुल", X0, y, { font: "B", size: 10, color: "#000" });
    text(money(rec.total), X0, y, { font: "B", size: 11, color: "#000", w: CW, align: "right" }); y += 15;
    if (S.showAmountWords) { text(rupeesInWords(rec.total), X0, y, { size: 6.8, color: "#000", w: CW, align: "center", fitTo: CW }); y += 12; }
    if (qrOn) {
      const data = paid
        ? `${verify.baseUrl.replace(/\/$/, "")}/verify/r/${verify.codes[rec.receiptNo]}`
        : upiLink({ upiId: S.upiId, upiName: S.upiName || trust.name, amount: rec.total, note: `${m.registrationNumber || ""} ${title}` });
      qr(data, W / 2 - 38, y + 4, 76, "#000");
      y += 84;
      text(paid ? "स्कैन कर रसीद जाँचें" : `स्कैन कर भुगतान करें · ${S.upiId}`, X0, y, { font: "B", size: 6.6, color: "#000", w: CW, align: "center", fitTo: CW });
      y += 12;
    }
    const agentName = m.agentName || p.agentInfo?.displayName || "";
    if (agentName) { text(`एजेंट: ${agentName} ${m.agentPhone || ""}`, X0, y, { size: 6.8, color: "#000", w: CW, align: "center", fitTo: CW }); y += 10; }
    para(paid ? S.paidNote : S.pendingNote, X0, y + 2, CW, { size: 6.4, color: "#000" });
  };

  // ── pages ──
  if (!plan.length) {
    doc.addPage({ size: A5, margin: 0 });
    text(paid ? "कोई भुगतान की गई रसीद नहीं है" : "कोई बकाया रसीद नहीं है", 0, 290, { size: 12, color: "#888", w: A5[0], align: "center" });
  } else if (L.key === "thermal") {
    for (const rec of plan) drawThermal(rec);
  } else {
    // every receipt page as a slot; then lay slots onto paper
    const slots = [];
    for (const rec of plan) {
      const per = L.rows;
      const pages = Math.max(1, Math.ceil(rec.rows.length / per));
      for (let pi = 0; pi < pages; pi++) slots.push({ rec, rows: rec.rows.slice(pi * per, (pi + 1) * per), pi, pages, firstSr: pi * per + 1 });
    }
    if (L.key === "a4x2") {
      const [W, H] = [A4[1], A4[0]]; // landscape
      for (let i = 0; i < slots.length; i += 2) {
        doc.addPage({ size: [W, H], margin: 0 });
        for (let j = 0; j < 2 && i + j < slots.length; j++) {
          const s = slots[i + j];
          drawSlot(j * W / 2, 0, W / 2, H, s.rec, s.rows, s.pi, s.pages, s.firstSr, 1);
        }
        doc.moveTo(W / 2, 8).lineTo(W / 2, H - 8).dash(4, { space: 4 }).lineWidth(0.5).stroke("#9ca3af");
        doc.undash();
      }
    } else {
      const [W, H] = L.key === "a4" ? A4 : A5;
      const k = L.key === "a4" ? 1.12 : 1;
      for (const s of slots) {
        doc.addPage({ size: [W, H], margin: 0 });
        drawSlot(0, 0, W, H, s.rec, s.rows, s.pi, s.pages, s.firstSr, k);
      }
    }
  }
  doc.end();
  return finished;
}

/** Pages a run will need (for the job size check / part splitting). */
export function receiptPages(rowsCount, layoutKey) {
  const L = layoutOf(layoutKey);
  if (L.key === "thermal") return 1;
  const pages = Math.max(1, Math.ceil(rowsCount / L.rows));
  return L.key === "a4x2" ? pages / 2 : pages;
}
