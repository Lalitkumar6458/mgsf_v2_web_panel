// New रसीद engine, settings, receipt register + public verify.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { buildReceipts, planReceipts, receiptPages } from "../src/lib/pdf/receipts.js";
import { normalizeReceiptSettings, isUpiId, upiLink } from "../src/lib/receiptSettings.js";
import { rupeesInWords } from "../src/lib/amountWords.js";
import { registerReceipts } from "../src/services/receiptJobs.js";
import { receiptMembers } from "../src/services/reports.js";
import { verifyReceipt, verifyCertificate, certificateCode } from "../src/services/verify.js";
import { saveReceiptSettings, getReceiptSettings } from "../src/services/receiptSettings.js";

let admin, program;
before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "r@test.in", displayName: "R", trustInfo: { name: "Rasid Trust" } }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah" }).returning();
  const base = { programId: program.id, dateJoin: "2026-01-01", status: "accepted" };
  await db.insert(schema.members).values([
    { ...base, id: "p1", displayName: "Ramesh", registrationNumber: "R1", phone: "9876543210" },
    { ...base, id: "p2", displayName: "Suresh", registrationNumber: "R2" },
    { ...base, id: "c1", displayName: "Isha", closingDate: "2026-03-01" },
    { ...base, id: "c2", displayName: "Pooja", closingDate: "2026-04-01" },
  ]);
  await db.insert(schema.dues).values([
    { id: "d1", programId: program.id, closingMemberId: "c1", payerMemberId: "p1", amount: 200, paidAmount: 200, status: "paid" },
    { id: "d2", programId: program.id, closingMemberId: "c2", payerMemberId: "p1", amount: 300, paidAmount: 300, status: "paid" },
    { id: "d3", programId: program.id, closingMemberId: "c1", payerMemberId: "p2", amount: 200, paidAmount: 0, status: "pending" },
  ]);
});
after(() => pool.end());

test("amount in words, UPI id check, settings normalize", () => {
  assert.equal(rupeesInWords(1500), "एक हज़ार पाँच सौ रुपये मात्र");
  assert.equal(rupeesInWords(250000), "दो लाख पचास हज़ार रुपये मात्र");
  assert.equal(isUpiId("trust@sbi"), true);
  assert.equal(isUpiId("not an id"), false);
  const s = normalizeReceiptSettings({ layout: "weird", theme: "green", showUpiQr: true, upiId: "bad", dueDays: 999, signImg: "data:image/png;base64,AAA" });
  assert.equal(s.layout, "a5");
  assert.equal(s.theme, "green");
  assert.equal(s.showUpiQr, false); // no valid UPI id → no QR
  assert.equal(s.dueDays, 15);
  assert.equal(s.signImg, ""); // data URLs are never stored
  assert.match(upiLink({ upiId: "trust@sbi", upiName: "T", amount: 450.4 }), /^upi:\/\/pay\?pa=trust%40sbi&pn=T&am=450&cu=INR/);
});

test("plan: numbers only for members with rows of the wanted status; pages by layout", () => {
  const members = [
    { memberId: "a", marriages: [{ status: "paid", amount: 100 }, { status: "pending", amount: 50 }] },
    { memberId: "b", marriages: [{ status: "pending", amount: 50 }] },
    { memberId: "c", marriages: [{ status: "paid", amount: 70 }] },
  ];
  const plan = planReceipts(members, { status: "paid", receiptStartNo: 7, receiptPrefix: "MG/" });
  assert.deepEqual(plan.map((p) => [p.member.memberId, p.receiptNo, p.total]), [["a", "MG/0007", 100], ["c", "MG/0008", 70]]);
  assert.equal(receiptPages(25, "a5"), 3);
  assert.equal(receiptPages(25, "a4"), 2);
  assert.equal(receiptPages(25, "thermal"), 1);
  assert.equal(receiptPages(5, "a4x2"), 0.5);
});

test("every layout renders a real PDF; 200 receipts quickly", async () => {
  const members = await receiptMembers(program.id, { status: "paid" });
  for (const layout of ["a5", "a4", "a4x2", "thermal"]) {
    const pdf = await buildReceipts({ members, paymentStatus: "paid", settings: { layout, showVerifyQr: true }, TrustData: { name: "T" },
      verify: { baseUrl: "https://x.in", codes: { "0001": "ABCDEFGH23" } } });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", layout);
  }
  const many = Array.from({ length: 200 }, (_, i) => ({ memberId: "m" + i, displayName: "राम " + i, marriages: Array.from({ length: 6 }, () => ({ status: "pending", amount: 200, closingMemberName: "सीता", marriageDate: "01-08-2026" })) }));
  const t = Date.now();
  const pdf = await buildReceipts({ members: many, paymentStatus: "pending", settings: { showUpiQr: true, upiId: "trust@sbi" }, TrustData: { name: "T" } });
  assert.ok(pdf.length > 1000);
  assert.ok(Date.now() - t < 8000, `took ${Date.now() - t} ms`);
});

test("register + verify: paid receipt found, reversal flagged, fake code not found", async () => {
  const members = await receiptMembers(program.id, { status: "paid" });
  const codes = await registerReceipts({ adminId: admin.id, programId: program.id, members, start: 5, prefix: "", by: "acc" });
  assert.deepEqual(Object.keys(codes), ["0005"]);
  let v = await verifyReceipt(codes["0005"]);
  assert.equal(v.status, "valid");
  assert.equal(v.amount, 500);
  assert.equal(v.entries, 2);
  assert.equal(v.member.name, "Ramesh");
  assert.equal(v.member.phone, "••••••3210");
  assert.equal(v.trust.name, "Rasid Trust");
  await db.execute(sql`UPDATE dues SET status = 'pending', paid_amount = 0 WHERE id = 'd2'`);
  v = await verifyReceipt(codes["0005"].toLowerCase());
  assert.equal(v.status, "changed");
  assert.equal(await verifyReceipt("NOPE123456"), null);
  assert.equal(await verifyReceipt("x"), null);
});

test("certificate verify: signed code only", async () => {
  const v = await verifyCertificate(certificateCode("p1"));
  assert.equal(v.status, "valid");
  assert.equal(v.member.registrationNumber, "R1");
  assert.equal(await verifyCertificate("p1.forgedsig123"), null);
  assert.equal(await verifyCertificate("nothing"), null);
});

test("settings stored per trust", async () => {
  await saveReceiptSettings(admin.id, { layout: "thermal", theme: "mono", upiId: "trust@sbi", showUpiQr: true });
  const s = await getReceiptSettings(admin.id);
  assert.equal(s.layout, "thermal");
  assert.equal(s.showUpiQr, true);
});
