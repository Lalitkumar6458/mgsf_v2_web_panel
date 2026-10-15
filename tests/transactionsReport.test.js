// Payments page PDF: drawn with pdfkit (fast), pages cut by hand.  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTransactionsReport, paginate } from "../src/lib/pdf/transactionsReport.js";

test("paginate: every row on exactly one page, total gets room on the last page", () => {
  for (const n of [0, 1, 20, 21, 22, 50, 999, 50000]) {
    const pages = paginate(n);
    let next = 0;
    for (const [a, b] of pages) { assert.equal(a, next); assert.ok(b >= a); next = b; }
    assert.equal(next, n, `n=${n}`);
  }
  assert.equal(paginate(0).length, 1);
});

test("report: 5,000 rows render quickly into a real PDF", async () => {
  const tx = Array.from({ length: 5000 }, (_, i) => ({
    id: "t" + i, transactionNumber: "TRX" + i, paymentDate: "2026-08-10", payerName: "ईशा कुमारी " + i, payerRegistrationNumber: "R" + i,
    marriageMemberName: "सुरेश " + i, amount: 200, paymentMethod: i % 2 ? "cash" : "online", onlineReference: i % 2 ? "" : "UPI" + i,
  }));
  const t = Date.now();
  const pdf = await buildTransactionsReport({ transactions: tx, summary: { totalTransactions: 5000, totalAmount: 1000000 }, programInfo: { name: "Vivah" }, TrustData: { name: "Trust", logo: "data:image/webp;base64,AAAA" } });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const pages = (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
  assert.equal(pages, paginate(5000).length);
  assert.ok(Date.now() - t < 15000, `took ${Date.now() - t} ms`);
});
