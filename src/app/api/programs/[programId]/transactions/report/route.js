// Transactions report PDF (Payments page → PDF). Drawn on the server in the PDF worker thread:
// a 3-month report can be thousands of rows, and drawing that in the browser froze the page.
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&q=&method=all|cash|online  → application/pdf
import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { badRequest } from "@/lib/errors.js";
import { listTransactions } from "@/services/payments.js";
import { getTrustProfile } from "@/services/trust.js";
import { renderPdf } from "@/services/receiptJobs.js";
import { toLegacyTransaction } from "@/lib/client/legacy";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ROWS = Number(process.env.TRX_PDF_MAX_ROWS || 60000); // 50,000 rows ≈ 15–20 s
const ddmmyyyy = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");

export const GET = route(async ({ auth, params, query }) => {
  const program = await getProgramFor(auth, params.programId);
  const from = query.get("from") || "";
  const to = query.get("to") || "";
  const q = (query.get("q") || "").trim();
  const method = ["cash", "online"].includes(query.get("method")) ? query.get("method") : "all";

  const opts = { all: true, status: "completed", from, to, q };
  if (auth.role === "agent") opts.agentId = auth.agentId;
  const r = await listTransactions(params.programId, opts);
  // plain fields only — the rows go to the worker thread (no functions / Date helpers)
  // a DATE column comes back as local midnight — format it locally, not via toISOString (that shifts IST a day back)
  const ymd = (d) => {
    if (!d) return "";
    if (!(d instanceof Date)) return String(d).slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const transactions = r.transactions
    .map(toLegacyTransaction)
    .filter((t) => method === "all" || t.paymentMethod === method) // same rule as the Payments page list
    .map((t) => ({
      id: t.id,
      transactionNumber: t.transactionNumber || "",
      paymentDate: ymd(t.paymentDate),
      payerName: t.payerName || "",
      payerRegistrationNumber: t.payerRegistrationNumber || "",
      marriageMemberName: t.marriageMemberName || "",
      marriageRegistrationNumber: t.marriageRegistrationNumber || "",
      amount: Number(t.amount) || 0,
      paymentMethod: t.paymentMethod || "",
      onlineReference: t.onlineReference || "",
      note: t.note || "",
    }));

  if (!transactions.length) throw badRequest("Is filter mein koi payment nahi hai");
  if (transactions.length > MAX_ROWS) {
    throw badRequest(`${transactions.length.toLocaleString("en-IN")} payments — ek PDF mein max ${MAX_ROWS.toLocaleString("en-IN")}. Chhoti date range chunein ya CSV lein.`);
  }

  const totalAmount = transactions.reduce((s, t) => s + (t.amount || 0), 0);
  const pdf = await renderPdf({
    transactions,
    summary: { totalAmount, totalTransactions: transactions.length },
    programInfo: { name: program?.name || "", hiname: program?.hiname || program?.extra?.hiname || "" },
    filters: {
      dateRange: from && to ? { start: ddmmyyyy(from), end: ddmmyyyy(to) } : null,
      paymentMethod: method,
      searchText: q,
    },
    generatedDate: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }),
    TrustData: await getTrustProfile(program.adminId),
  }, "transactions");

  const name = `${String(program?.name || "Program").replace(/[^\w\-]+/g, "_")}_Transactions_${transactions.length}.pdf`;
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
      "X-Rows": String(transactions.length),
    },
  });
});
