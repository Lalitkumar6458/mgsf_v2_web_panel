// PDFs the mobile app downloads (GET + Bearer token). All lists use lib/pdf/listReport.js,
// receipts use the same rasid engine as the panel (lib/pdf/receipts.js).
import { getTrustProfile } from "./trust.js";
import { renderPdf, registerReceipts } from "./receiptJobs.js";
import { receiptMembers } from "./reports.js";
import { receiptSettingsForPdf } from "./receiptSettings.js";
import { agentBatch, agentClosing, agentMembers, memberDetail } from "./mobileApp.js";
import { notFound } from "../lib/errors.js";

const inr = (v) => `₹${Math.round(Number(v) || 0).toLocaleString("en-IN")}`;
const dmy = (v) => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : "—"; };
const RED = "#b91c1c", GREEN = "#15803d", AMBER = "#a16207";

async function list(adminId, props) {
  return renderPdf({ TrustData: await getTrustProfile(adminId), ...props }, "list");
}

/** One member's account: all / pending / paid / late closings. */
export async function statementPdf(auth, m, mode = "all") {
  const d = await memberDetail(m.id, m);
  const pick = {
    all: () => true, pending: (r) => r.remaining > 0, paid: (r) => r.status === "paid", late: (r) => r.timing === "late" || r.overdue,
  }[mode] || (() => true);
  const rows = d.timeline.filter(pick).reverse();
  const title = { all: "सदस्य खाता — पूरा विवरण", pending: "सदस्य खाता — बकाया", paid: "सदस्य खाता — जमा", late: "सदस्य खाता — देर से / ओवरड्यू" }[mode] || "सदस्य खाता";
  const mem = d.member;
  return list(auth.adminId, {
    title,
    subtitle: `${mem.displayName}${mem.fatherName ? ` पुत्र/पत्नी ${mem.fatherName}` : ""} · रजि. ${mem.registrationNumber || "—"} · ${mem.programName || ""}`,
    info: [["मोबाइल:", mem.phone || "—"], ["गाँव:", mem.village || "—"], ["जुड़े:", dmy(mem.dateJoin)], ["प्रति क्लोजिंग:", inr(mem.payAmount)]],
    cards: [
      ["कुल बकाया", inr(d.summary.pendingAmount + d.joinFee.due), "red"],
      ["क्लोजिंग जमा", inr(d.summary.paidAmount), "green"],
      ["बाकी क्लोजिंग", String(d.summary.pendingCount), "amber"],
      ["समय पर / देर से", `${d.summary.onTimeCount} / ${d.summary.lateCount}`, "blue"],
      ["नामांकन शुल्क बाकी", inr(d.joinFee.due), "brand"],
    ],
    columns: [
      { key: "seq", label: "क्र.", w: 30, align: "center" }, { key: "name", label: "क्लोजिंग (नाम / रजि.)", w: 150 },
      { key: "date", label: "क्लोजिंग तिथि", w: 62, align: "center" }, { key: "due", label: "अंतिम तिथि", w: 62, align: "center" },
      { key: "amount", label: "राशि", w: 50, align: "right" }, { key: "paid", label: "जमा", w: 50, align: "right" },
      { key: "left", label: "बाकी", w: 50, align: "right" }, { key: "state", label: "स्थिति", w: 78 },
    ],
    rows: rows.map((r) => ({
      seq: r.seq || "", name: `${r.name}${r.regNo ? ` (${r.regNo})` : ""}`, date: dmy(r.date), due: dmy(r.dueBy),
      amount: inr(r.amount), paid: r.paid ? inr(r.paid) : "—", left: r.remaining ? inr(r.remaining) : "—", leftColor: r.remaining ? RED : undefined,
      state: r.status === "paid" ? (r.timing === "late" ? `देर से (${r.lateByDays} दिन)` : `जमा ${dmy(r.paidAt)}`) : r.overdue ? `${r.overdueDays} दिन देर` : r.status === "partial" ? "आंशिक" : "बकाया",
      stateColor: r.status === "paid" ? (r.timing === "late" ? AMBER : GREEN) : r.overdue ? RED : AMBER,
    })),
    total: { name: `कुल ${rows.length} क्लोजिंग`, amount: inr(rows.reduce((a, r) => a + r.amount, 0)), paid: inr(rows.reduce((a, r) => a + r.paid, 0)), left: inr(rows.reduce((a, r) => a + r.remaining, 0)) },
    note: `समय पर = अंतिम तिथि (क्लोजिंग के ${d.graceDays} दिन) तक जमा। यह विवरण कंप्यूटर से बना है।`,
  });
}

/** Agent: his members — pending / paid / joining-fee-due list. */
export async function agentDuesPdf(auth, { programId, mode = "pending" }) {
  const f = mode === "paid" ? "paid" : mode === "fee" ? "feeDue" : "due";
  const all = [];
  let page = 1, res;
  do {
    res = await agentMembers(auth, { programId, f, page, limit: 200 });
    all.push(...res.members);
    page++;
  } while (page <= res.pages && page <= 50);
  const fee = mode === "fee";
  const title = fee ? "नामांकन शुल्क बाकी — सदस्य सूची" : mode === "paid" ? "पूरा जमा — सदस्य सूची" : "क्लोजिंग बकाया — सदस्य सूची";
  return list(auth.adminId, {
    title,
    subtitle: `एजेंट: ${auth.displayName || ""}`,
    info: [["सदस्य:", String(all.length)], ["तिथि:", new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })]],
    cards: fee
      ? [["शुल्क बाकी", inr(res.totals.feeDueAmount), "red"], ["शुल्क जमा", inr(res.totals.feePaidAmount), "green"], ["सदस्य", String(all.length), "blue"]]
      : [["कुल बकाया", inr(res.totals.dueAmount), "red"], ["कुल जमा", inr(res.totals.paidAmount), "green"], ["सदस्य", String(all.length), "blue"]],
    columns: [
      { key: "i", label: "क्र.", w: 28, align: "center" }, { key: "reg", label: "रजि.", w: 58 }, { key: "name", label: "नाम", w: 110 },
      { key: "father", label: "पिता / पति", w: 95 }, { key: "village", label: "गाँव", w: 70 }, { key: "phone", label: "मोबाइल", w: 68 },
      ...(fee ? [{ key: "fee", label: "शुल्क बाकी", w: 60, align: "right" }]
        : [{ key: "count", label: "बाकी क्लो.", w: 46, align: "center" }, { key: "amount", label: mode === "paid" ? "जमा" : "बकाया", w: 60, align: "right" }]),
    ],
    rows: all.map((m, i) => ({
      i: i + 1, reg: m.registrationNumber, name: m.displayName, father: m.fatherName, village: m.village, phone: m.phone,
      fee: inr(m.joinFeesDue), count: m.dueCount || "—", amount: inr(mode === "paid" ? m.paidAmount : m.dueAmount),
      amountColor: mode === "paid" ? GREEN : RED, feeColor: RED,
    })),
    total: fee ? { name: "कुल", fee: inr(res.totals.feeDueAmount) } : { name: "कुल", amount: inr(mode === "paid" ? res.totals.paidAmount : res.totals.dueAmount) },
  });
}

function payerColumns(withClosings) {
  return [
    { key: "i", label: "क्र.", w: 28, align: "center" }, { key: "reg", label: "रजि.", w: 58 }, { key: "name", label: "नाम", w: 115 },
    { key: "father", label: "पिता / पति", w: 95 }, { key: "village", label: "गाँव", w: 70 }, { key: "phone", label: "मोबाइल", w: 68 },
    ...(withClosings ? [{ key: "cl", label: "क्लोजिंग", w: 44, align: "center" }] : []),
    { key: "amount", label: "राशि", w: 58, align: "right" },
  ];
}
const pickRows = (rows, mode) => rows.filter((r) => (mode === "pending" ? r.remaining > 0 : mode === "paid" ? r.remaining <= 0 : true));
const payerRow = (r, i, mode, withClosings) => ({
  i: i + 1, reg: r.registrationNumber, name: r.displayName, father: r.fatherName, village: r.village, phone: r.phone,
  cl: withClosings ? `${r.pendingClosings}/${r.closings}` : undefined,
  amount: inr(mode === "paid" || r.remaining <= 0 ? r.paid : r.remaining), amountColor: r.remaining > 0 ? RED : GREEN,
});

export async function closingPdf(auth, closingId, mode = "pending") {
  const d = await agentClosing(auth, closingId);
  const rows = pickRows(d.rows, mode);
  const c = d.closing;
  return list(auth.adminId, {
    title: `क्लोजिंग #${c.seq} — ${mode === "paid" ? "जमा" : mode === "pending" ? "बकाया" : "सभी"} सदस्य`,
    subtitle: `${c.name}${c.regNo ? ` (${c.regNo})` : ""}${c.village ? ` · ${c.village}` : ""} · ${dmy(c.date)}${c.batchName ? ` · समूह: ${c.batchName}` : ""}`,
    info: [["एजेंट:", auth.displayName || ""], ["अंतिम तिथि:", dmy(c.dueBy)], ["सदस्य:", String(rows.length)]],
    cards: [["बकाया", inr(d.totals.pendingAmount), "red"], ["जमा", inr(d.totals.paidAmount), "green"], ["बाकी सदस्य", String(d.totals.pendingMembers), "amber"]],
    columns: payerColumns(false),
    rows: rows.map((r, i) => payerRow(r, i, mode, false)),
    total: { name: "कुल", amount: inr(rows.reduce((a, r) => a + (mode === "paid" || r.remaining <= 0 ? r.paid : r.remaining), 0)) },
  });
}

export async function batchPdf(auth, batchId, mode = "pending") {
  const d = await agentBatch(auth, batchId);
  const rows = pickRows(d.rows, mode);
  return list(auth.adminId, {
    title: `क्लोजिंग समूह — ${d.batch.name}`,
    subtitle: `${mode === "paid" ? "पूरा जमा" : mode === "pending" ? "बकाया" : "सभी"} सदस्य · ${d.batch.closings} क्लोजिंग${d.batch.dueBy ? ` · अंतिम तिथि ${dmy(d.batch.dueBy)}` : ""}`,
    info: [["एजेंट:", auth.displayName || ""], ["सदस्य:", String(rows.length)]],
    cards: [["बकाया", inr(d.totals.pendingAmount), "red"], ["जमा", inr(d.totals.paidAmount), "green"], ["बाकी सदस्य", String(d.totals.pendingMembers), "amber"], ["क्लोजिंग", String(d.batch.closings), "blue"]],
    columns: payerColumns(true),
    rows: rows.map((r, i) => payerRow(r, i, mode, true)),
    total: { name: "कुल", amount: inr(rows.reduce((a, r) => a + (mode === "paid" || r.remaining <= 0 ? r.paid : r.remaining), 0)) },
  });
}

/** One payment's rasid (the closings paid in that batch), or a member's pending / paid rasid. */
export async function receiptPdf(auth, m, { batchId, status = "paid", origin }) {
  let members = await receiptMembers(m.program_id, { status: status === "pending" ? "pending" : "paid", memberIds: [m.id] });
  if (batchId) {
    const { db } = await import("../db/index.js");
    const { sql } = await import("drizzle-orm");
    const { rows } = await db.execute(sql`SELECT due_id FROM transactions WHERE batch_id = ${batchId} AND payer_member_id = ${m.id} AND due_id IS NOT NULL`);
    const ids = new Set(rows.map((r) => r.due_id));
    members = members.map((x) => ({ ...x, marriages: x.marriages.filter((d) => ids.has(d.paymentId)) })).filter((x) => x.marriages.length);
  }
  if (!members.length) throw notFound(status === "pending" ? "कोई बकाया नहीं है" : "इस भुगतान की रसीद नहीं मिली");
  const settings = await receiptSettingsForPdf(auth.adminId, auth.features);
  const paid = status !== "pending";
  const codes = paid && settings.showVerifyQr
    ? await registerReceipts({ adminId: auth.adminId, programId: m.program_id, members, start: 1, prefix: "", by: auth.accountId }).catch(() => ({}))
    : {};
  return renderPdf({
    members, agentInfo: {}, programInfo: { id: m.program_id, name: m.program_name }, paymentStatus: paid ? "paid" : "pending",
    receiptStartNo: 1, receiptPrefix: "", TrustData: await getTrustProfile(auth.adminId), settings, verify: { baseUrl: origin, codes },
  }, "receipts");
}
