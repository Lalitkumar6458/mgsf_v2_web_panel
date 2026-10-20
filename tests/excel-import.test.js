// Excel / CSV import (Members page → Import): sample, check, run, undo.   npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { createMember } from "../src/services/members.js";
import { parseCsv, readWorkbook, sampleWorkbook, sampleCsv, checkUpload, startChecked, getImport, undoImport, importLoginsCsv, listImports } from "../src/services/excelImport.js";

let admin, program, E;
const office = () => ({ role: "admin", adminId: admin.id, accountId: "office", displayName: "Office" });
const wait = async (id) => {
  for (let i = 0; i < 200; i++) {
    const j = await getImport(admin.id, id);
    if (j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("import did not finish");
};
async function xlsx(members, payments) {
  const wb = new ExcelJS.Workbook();
  const m = wb.addWorksheet("Members"); members.forEach((r) => m.addRow(r));
  if (payments) { const p = wb.addWorksheet("Payments"); payments.forEach((r) => p.addRow(r)); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const H = ["Reg. No.", "Naam *", "Pita / Pati", "Mobile", "Janam tithi", "Join date *", "Kist", "Join fee", "Join fee jama", "Agent", "Status", "Closing date", "Closing group"];

before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps, migration_jobs RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "xl@test.in", displayName: "XL" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah", regMode: "series", regPrefix: "X" }).returning();
  await db.insert(schema.agents).values({ id: "AGX", adminId: admin.id, displayName: "Suresh", email: "suresh@xl.in" });
  E = (await createMember(program, { displayName: "Purana", dateJoin: "2025-01-01", payAmount: 200 }, office())).member.id;
});
after(() => pool.end());

test("CSV reader: quotes, commas, BOM, Hindi; sample files open", async () => {
  assert.deepEqual(parseCsv('﻿नाम,"Pata, gaon"\r\n"Ram ""ji""",Jodhpur\n\n'), [["नाम", "Pata, gaon"], ['Ram "ji"', "Jodhpur"]]);
  const s = await readWorkbook(Buffer.from(sampleCsv("members")), "a.csv");
  assert.equal(s.members.length, 2);
  assert.equal((await readWorkbook(Buffer.from(sampleCsv("payments")), "p.csv")).payments.length, 2);
  const wb = await readWorkbook(await sampleWorkbook(program, { agents: [{ displayName: "Suresh", email: "suresh@xl.in" }] }), "s.xlsx");
  assert.equal(wb.members.length, 3);
  assert.equal(wb.payments.length, 2);
  const chk = await checkUpload(program, await sampleWorkbook(program, { agents: [{ email: "suresh@xl.in" }] }), "s.xlsx");
  assert.equal(chk.summary.members, 0); // the sample's example lines are never imported
  assert.equal(chk.summary.payments, 0);
  assert.deepEqual(chk.errors, []);
});

test("check: row-wise errors, nothing written", async () => {
  const buf = await xlsx([H,
    ["", "", "", "", "", "01-01-2025"],
    ["", "A", "", "", "", "32-01-2025"],
    ["X9", "B", "", "", "", "01-01-2025", "", "", "", "nobody@x.in"],
    ["X9", "C", "", "", "", "01-01-2025", "abc"],
    ["", "D", "", "", "", "01-01-2025", "", "", "", "", "closed"],
    ["X8", "Early", "", "", "", "01-01-2024", "", "", "", "", "closed", "01-06-2024"],
  ], [["Bharne wala Reg. No.", "Closing wala Reg. No.", "Rakam", "Tareekh"], ["X1", "X1", "200", "01-02-2025"], ["X9", "NONE", "0", "2099-01-01"], ["X9", "X8", "200", "01-02-2025"]]);
  const r = await checkUpload(program, buf, "bad.xlsx");
  const msg = r.errors.map((e) => `${e.sheet}:${e.row}:${e.column}`);
  for (const x of ["Members:2:Naam", "Members:3:Join date", "Members:4:Agent", "Members:5:Reg. No.", "Members:5:Kist", "Members:6:Closing date",
    "Payments:2:Bharne wala Reg. No.", "Payments:3:Rakam", "Payments:4:Bharne wala Reg. No.", "Payments:3:Tareekh", "Payments:3:Closing wala Reg. No."]) assert.ok(msg.includes(x), `${x} missing in ${msg}`);
  await assert.rejects(startChecked(program, r.token, office()), /galtiyan/);
  assert.equal((await db.execute(sql`SELECT count(*)::int AS n FROM members`)).rows[0].n, 1);
});

let jobId;
test("import: members get reg. no. + login + dues, old closing makes dues for everyone, payment paid with commission", async () => {
  const buf = await xlsx([H,
    ["X101", "Ram", "Shyam", "9000000001", "10-05-1996", "01-01-2025", "200", "500", "500", "suresh@xl.in"],
    ["", "Sita", "Mohan", "", "", "01-01-2025", "", "", "", "Suresh"],
    ["X103", "Gita", "", "", "", "01-01-2025", "200", "", "", "", "closed", "10-06-2025", "June 2025"],
    ["", "Band", "", "", "", "01-01-2025", "", "", "", "", "blocked"],
  ], [["Bharne wala Reg. No.", "Closing wala Reg. No.", "Rakam", "Tareekh", "Tarika", "Reference"],
      ["X101", "X103", "200", "20-06-2025", "upi", "UTR9988"]]);
  const chk = await checkUpload(program, buf, "ok.xlsx");
  assert.deepEqual(chk.errors, []);
  assert.equal(chk.summary.closed, 1);
  ({ jobId } = await startChecked(program, chk.token, office()));
  await assert.rejects(startChecked(program, chk.token, office()), /purani/); // a token works once
  const j = await wait(jobId);
  assert.equal(j.status, "done", JSON.stringify(j.report?.failures));
  assert.deepEqual(j.report.failures, []);
  assert.equal(j.report.created, 4);
  assert.equal(j.report.closings, 1);
  assert.equal(j.report.payments, 1);
  assert.deepEqual(j.report.failures, []);

  const m = Object.fromEntries((await db.execute(sql`SELECT display_name, id, registration_number, status::text, blocked, agent_id, join_fees_paid_amount, closing_group_id FROM members`)).rows.map((r) => [r.display_name, r]));
  assert.equal(m.Ram.registration_number, "X101");
  assert.equal(m.Sita.agent_id, "AGX");
  assert.ok(m.Sita.registration_number);
  assert.equal(m.Band.blocked, true);
  assert.ok(m.Gita.closing_group_id);
  // dues for Gita's closing: old member too
  const dues = (await db.execute(sql`SELECT p.display_name AS p, d.paid_amount, d.status::text AS s FROM dues d JOIN members p ON p.id = d.payer_member_id WHERE d.closing_member_id = ${m.Gita.id} ORDER BY 1`)).rows;
  assert.deepEqual(dues.map((d) => `${d.p}:${d.paid_amount}:${d.s}`).filter((x) => !x.startsWith("Band")), ["Purana:0:pending", "Ram:200:paid", "Sita:0:pending"]);
  const [t] = (await db.execute(sql`SELECT online_reference, payment_method, payment_date::text FROM transactions WHERE payer_member_id = ${m.Ram.id}`)).rows;
  assert.deepEqual(t, { online_reference: "UTR9988", payment_method: "upi", payment_date: "2025-06-20" });
  const [jf] = (await db.execute(sql`SELECT amount, payment_date::text FROM join_fee_payments WHERE member_id = ${m.Ram.id}`)).rows;
  assert.deepEqual(jf, { amount: 500, payment_date: "2025-01-01" });
  // logins: encrypted in the job, CSV on demand
  const csv = await importLoginsCsv(admin.id, jobId);
  assert.match(csv, /X101,"Ram",/);
  assert.equal((await db.execute(sql`SELECT count(*)::int AS n FROM accounts WHERE login_id = 'x101'`)).rows[0].n, 1);
  assert.equal((await listImports(admin.id, program.id)).length, 1);
  // same reg. no. again → refused at check
  const again = await checkUpload(program, buf, "ok.xlsx");
  assert.ok(again.errors.some((e) => /pehle se/.test(e.message)));
});

test("undo removes the imported members, their logins and the dues they caused", async () => {
  const r = await undoImport(admin.id, jobId);
  assert.equal(r.removed, 4);
  assert.deepEqual((await db.execute(sql`SELECT display_name FROM members`)).rows, [{ display_name: "Purana" }]);
  assert.equal((await db.execute(sql`SELECT count(*)::int AS n FROM dues WHERE payer_member_id = ${E}`)).rows[0].n, 0);
  assert.equal((await db.execute(sql`SELECT count(*)::int AS n FROM transactions`)).rows[0].n, 0);
  assert.equal((await db.execute(sql`SELECT count(*)::int AS n FROM accounts WHERE member_id IS NOT NULL AND member_id <> ${E}`)).rows[0].n, 0);
  await assert.rejects(undoImport(admin.id, jobId), /pehle hi/);
});
