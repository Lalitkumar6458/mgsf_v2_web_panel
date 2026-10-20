// Data migration engine (panel page "Data migration"): both Firebase sources → Postgres, then verify.   npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { importRaw, revertInfo, revertJob } from "../src/services/migration/jobs.js";
import { storagePath } from "../src/services/migration/files.js";

const IST = (d) => Date.parse(`${d}T00:00:00+05:30`);
before(async () => { await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`); });
after(() => pool.end());

/** A small new-trust-project trust: ledger members, closings with seq, receipts, commission. */
function trustNewFixture() {
  const m = (id, extra) => ({ id, programId: "p1", status: "accepted", joinDate: "01-01-2026", joinDateMs: IST("2026-01-01"), payAmount: 200,
    registrationNumber: `V${id.slice(1).padStart(3, "0")}`, displayName: `Name ${id}`, paidUpTo: 0, paidSeqs: [], exemptSeqs: [], partialPaid: {}, delete_flag: false, ...extra });
  return {
    id: "T1", data: { branding: { nameHi: "श्री टेस्ट ट्रस्ट", nameEn: "Test Trust", phone: ["9000000001"], email: "office@t1.in", logoURL: "https://firebasestorage.googleapis.com/v0/b/t1.appspot.com/o/logo%2Fa.png?alt=media&token=x" } },
    users: [{ id: "u1", role: "owner", email: "owner@t1.in", displayName: "Owner" }],
    agents: [{ id: "ag1", displayName: "Ramesh", email: "ramesh@t1.in", phone: "9000000002", delete_flag: false }],
    members: [
      m("M1", { agentId: "ag1", phone: "98765-00001", paidUpTo: 2, joinFees: 500, joinFeesPaid: 500, photoURL: "https://firebasestorage.googleapis.com/v0/b/t1.appspot.com/o/m%2F1.jpg?alt=media&token=y" }),
      m("M2", { paidSeqs: [1] }),
      m("M3", { status: "closed", closingId: "c1", closingDateMs: IST("2026-03-01"), exitDateMs: IST("2026-03-01"), exitReason: "closed" }),
      m("M4", { status: "closed", closingId: "c2", closingDateMs: IST("2026-04-01"), exitDateMs: IST("2026-04-01"), exitReason: "closed" }),
      m("M5", { joinDate: "15-03-2026", joinDateMs: IST("2026-03-15"), paidSeqs: [2] }),   // ledger says paid, no receipt
      m("M6", { exemptSeqs: [1], joinFees: 300, joinFeesDone: true }),                       // waived c1; old fee flag
      m("M7", { status: "left", exitDateMs: IST("2026-03-20"), exitReason: "left" }),       // left before c2
    ],
    requests: [{ id: "Q1", programId: "p1", agentId: "ag1", status: "pending", data: { displayName: "Naya Sadasya", phone: "9111111111", joinDate: "10-10-2026" } }],
    programs: [{
      id: "p1", name: "Vivah", ageGroups: [{ id: "a1", startAge: 0, endAge: 100, payAmount: 200, joinFee: 500 }],
      registration: { mode: "sequential", prefix: "V", startFrom: 1, padding: 3 },
      commissionPolicy: { joinFee: { enabled: true, mode: "percent", value: 10 }, collection: { enabled: true, mode: "percent", value: 5 } },
      _closings: [
        { id: "c1", seq: 1, memberId: "M3", closingDate: "01-03-2026", closingDateMs: IST("2026-03-01"), status: "active", batchId: "b1", notes: "vivah" },
        { id: "c2", seq: 2, memberId: "M4", closingDate: "01-04-2026", closingDateMs: IST("2026-04-01"), status: "active" },
        { id: "c9", seq: 3, memberId: "M2", closingDate: "01-05-2026", closingDateMs: IST("2026-05-01"), status: "reverted" },
      ],
      _payments: [
        { id: "R1", receiptNo: "RSD-1", memberId: "M1", method: "upi", reference: "UTR1", paidAtMs: IST("2026-04-05"), status: "completed", collectedByAgentId: "ag1",
          items: [{ closingId: "c1", seq: 1, amount: 200 }, { closingId: "c2", seq: 2, amount: 200 }], closingAmount: 400, joinFeeAmount: 500 },
        { id: "R2", receiptNo: "RSD-2", memberId: "M2", method: "cash", paidAtMs: IST("2026-03-10"), status: "completed", items: [{ closingId: "c1", seq: 1, amount: 200 }], closingAmount: 200 },
        { id: "R3", receiptNo: "RSD-3", memberId: "M2", method: "cash", paidAtMs: IST("2026-04-10"), status: "cancelled", items: [{ closingId: "c2", seq: 2, amount: 200 }], closingAmount: 200 },
      ],
      _units: [], _batches: [{ id: "b1", name: "March group" }],
      _commissionEntries: [
        { id: "ce1", agentId: "ag1", type: "collection", sourceType: "payment", sourceId: "R1", receiptNo: "RSD-1", memberId: "M1", baseAmount: 400, rateMode: "percent", rateValue: 5, amount: 20, status: "paid", payoutId: "po1", earnedAtMs: IST("2026-04-05") },
        { id: "ce2", agentId: "ag1", type: "join_fee", sourceType: "joinFee", sourceId: "R1", receiptNo: "RSD-1", memberId: "M1", baseAmount: 500, rateMode: "percent", rateValue: 10, amount: 50, status: "earned", earnedAtMs: IST("2026-04-05") },
      ],
      _payouts: [{ id: "po1", agentId: "ag1", payoutNo: "PAY-1", netTotal: 20, status: "paid", paidAtMs: IST("2026-05-01"), entryCount: 1 }],
      _counters: { seq: { registration: 7 } },
    }],
  };
}
const due = async (payer, closing) => (await db.execute(sql`
  SELECT amount, paid_amount, status::text AS status FROM dues WHERE payer_member_id = ${payer} AND closing_member_id = ${closing}`)).rows[0] || null;

test("new-trust-project: ledger + receipts → dues, transactions, join fee, commission, logins; verify is clean", async () => {
  const r = await importRaw("trustNew", trustNewFixture(), { adminPassword: "Owner@12345" });
  assert.equal(r.verify.ok, true, JSON.stringify(r.verify.checks, null, 1));
  // c1 (01-03): M1 paid (watermark), M2 paid (paidSeqs + receipt), M4 pending, M6 waived → no due, M5 joined later → no due
  assert.deepEqual(await due("M1", "M3"), { amount: 200, paid_amount: 200, status: "paid" });
  assert.deepEqual(await due("M2", "M3"), { amount: 200, paid_amount: 200, status: "paid" });
  assert.deepEqual(await due("M4", "M3"), { amount: 200, paid_amount: 0, status: "pending" });
  assert.equal(await due("M6", "M3"), null);
  assert.equal(await due("M5", "M3"), null);
  // c2 (01-04): M3 closed before → no; M2 cancelled receipt → pending; M5 ledger-only → paid with a migration entry; M7 left before → no
  assert.equal(await due("M3", "M4"), null);
  assert.deepEqual(await due("M2", "M4"), { amount: 200, paid_amount: 0, status: "pending" });
  assert.deepEqual(await due("M5", "M4"), { amount: 200, paid_amount: 200, status: "paid" });
  assert.equal(await due("M7", "M4"), null);
  assert.equal(r.bundle.reconcile.migrationTransactions, 1);
  const { rows: tx } = await db.execute(sql`SELECT transaction_number, status, payment_method, created_by_id FROM transactions ORDER BY transaction_number`);
  assert.deepEqual(tx.filter((x) => !x.transaction_number.startsWith("MIG")).map((x) => `${x.transaction_number}:${x.status}`),
    ["RSD-1-1:completed", "RSD-1-2:completed", "RSD-2:completed", "RSD-3:reversed"]);
  assert.equal(tx.filter((x) => x.transaction_number.startsWith("MIG") && x.payment_method === "other").length, 1);
  // agent's collections carry his login (cash hisaab)
  const { rows: [agAcc] } = await db.execute(sql`SELECT id FROM accounts WHERE agent_id = 'ag1'`);
  assert.equal(tx.find((x) => x.transaction_number === "RSD-1-1").created_by_id, agAcc.id);
  // join fee: receipt ₹500 for M1; M6 old "done" flag → migration ₹300
  const { rows: fees } = await db.execute(sql`SELECT m.id, m.join_fees_paid_amount, m.join_fees_done FROM members m WHERE m.id IN ('M1','M6') ORDER BY m.id`);
  assert.deepEqual(fees.map((f) => [f.id, f.join_fees_paid_amount, f.join_fees_done]), [["M1", 500, true], ["M6", 300, true]]);
  // commission: ₹20 on R1 spread over its 2 closings (paid, in payout), ₹50 join fee (pending)
  const { rows: com } = await db.execute(sql`SELECT source, amount::float AS amount, status, payout_id FROM agent_commissions ORDER BY source, amount`);
  assert.deepEqual(com.map((c) => `${c.source}:${c.amount}:${c.status}`), ["closing:10:paid", "closing:10:paid", "join_fees:50:pending"]);
  const { rows: [ag] } = await db.execute(sql`SELECT commission FROM agents WHERE id = 'ag1'`);
  assert.deepEqual([ag.commission.enabled, ag.commission.closing.value, ag.commission.joinFees.value], [true, 5, 10]);
  // closed members, groups, pending agent request
  const { rows: [m3] } = await db.execute(sql`SELECT status::text, closing_date, closing_group_id FROM members WHERE id = 'M3'`);
  assert.deepEqual(m3, { status: "closed", closing_date: "2026-03-01", closing_group_id: "b1" });
  const { rows: [q1] } = await db.execute(sql`SELECT status::text, agent_id FROM members WHERE id = 'Q1'`);
  assert.deepEqual(q1, { status: "pending", agent_id: "ag1" });
  // logins: member password = mobile number (same as there); admin with the given password; agent got a new one (in the file)
  const { rows: [ml] } = await db.execute(sql`SELECT password_hash FROM accounts WHERE login_id = 'v001'`);
  assert.ok(await bcrypt.compare("9876500001", ml.password_hash));
  const { rows: [al] } = await db.execute(sql`SELECT password_hash FROM accounts WHERE login_id = 'owner@t1.in'`);
  assert.ok(await bcrypt.compare("Owner@12345", al.password_hash));
  assert.ok(r.logins.some((l) => l.role === "agent" && l.loginId === "ramesh@t1.in"));
  // files listed for copy, trust info mapped
  assert.ok(r.bundle.files.some((f) => f.table === "members" && f.column === "photo_url"));
  assert.ok(r.bundle.files.some((f) => f.table === "admins" && f.key === "logo"));
  const { rows: [adm] } = await db.execute(sql`SELECT trust_info->>'name' AS name, trust_info->>'contact' AS contact FROM admins WHERE id = 'T1'`);
  assert.deepEqual(adm, { name: "श्री टेस्ट ट्रस्ट", contact: "9000000001" });
  // registration counter follows the numbers used (next member gets V008)
  const { rows: [p] } = await db.execute(sql`SELECT reg_counter, reg_prefix, reg_mode FROM programs WHERE id = 'p1'`);
  assert.deepEqual([p.reg_counter, p.reg_prefix, p.reg_mode], [7, "V", "series"]);
});

test("same trust again: 'new' is refused, 'replace' rewrites it cleanly", async () => {
  await assert.rejects(importRaw("trustNew", trustNewFixture(), { adminPassword: "x" }), /pehle se panel mein/);
  const r = await importRaw("trustNew", trustNewFixture(), { mode: "replace", adminPassword: "Owner@12345" });
  assert.equal(r.verify.ok, true);
  const { rows: [c] } = await db.execute(sql`SELECT count(*)::int AS n FROM members m JOIN programs p ON p.id = m.program_id WHERE p.admin_id = 'T1'`);
  assert.equal(c.n, 8);
});

test("old MGSF panel fixture → same result as the command-line script, money reconciled", async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  const raw = JSON.parse(fs.readFileSync("tests/fixtures/firestore-sample.json", "utf8")).users[0];
  const r = await importRaw("mgsf", raw, { adminPassword: "Admin@12345" });
  assert.equal(r.verify.ok, true, JSON.stringify(r.verify.checks, null, 1));
  assert.equal(r.verify.rows.members, raw.programs[0]._members.length);
  assert.ok(r.verify.rows.dues > 0);
});

test("dry run writes nothing; a login id used by another trust is skipped, not fatal", async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`); // (the MGSF fixture uses ids M1… too)
  await importRaw("trustNew", trustNewFixture(), { adminPassword: "Owner@12345" }); // T1 owns ramesh@t1.in
  const fx = trustNewFixture();
  fx.id = "T2"; fx.users[0].email = "owner@t2.in";
  fx.agents[0] = { ...fx.agents[0], id: "ag2", email: "ramesh@t1.in" }; // taken by T1
  for (const m of fx.members) m.id = `${m.id}x`;
  fx.members.forEach((m) => { if (m.closingId) m.closingId = `${m.closingId}`; });
  fx.programs[0].id = "p2"; fx.members.forEach((m) => { m.programId = "p2"; });
  fx.programs[0]._closings.forEach((c) => { c.id = `${c.id}x`; c.memberId = `${c.memberId}x`; });
  fx.programs[0]._payments.forEach((p) => { p.id = `${p.id}x`; p.memberId = `${p.memberId}x`; p.items.forEach((it) => { it.closingId = `${it.closingId}x`; }); });
  fx.programs[0]._commissionEntries = []; fx.programs[0]._payouts = []; fx.programs[0]._batches = [{ id: "b2", name: "G" }];
  fx.programs[0]._closings[0].batchId = "b2"; fx.requests = [];
  fx.members.forEach((m) => { m.agentId = m.agentId ? "ag2" : undefined; m.registrationNumber = m.registrationNumber.replace("V", "W"); });
  const dry = await importRaw("trustNew", fx, { dryRun: true });
  assert.ok(dry.bundle.counts.members > 0);
  const { rows: [none] } = await db.execute(sql`SELECT count(*)::int AS n FROM admins WHERE id = 'T2'`);
  assert.equal(none.n, 0);
  const r = await importRaw("trustNew", fx, { adminPassword: "Owner@12345" });
  assert.ok(r.skippedLogins.some((x) => x.loginId === "ramesh@t1.in"));
  assert.equal(r.verify.ok, true);
});

test("huge numbers (phone in a count / amount, ms timestamps, 12-digit reg. no.) don't break the write — fixed + warned", async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  const raw = JSON.parse(fs.readFileSync("tests/fixtures/firestore-sample.json", "utf8")).users[0];
  const p = raw.programs[0];
  p.regCounter = 98765432101; p.memberCount = 1771545600000;
  p._members[0].memberNumber = 9876543210; p._members[1].closingMonths = 1771545600000;
  p._members[2].registrationNumber = "202600000123";
  p._transactions[0].sequenceNumber = 1771545600123;
  p._members[3].payAmount = 9876543210;
  const r = await importRaw("mgsf", raw, { adminPassword: "Admin@12345" });
  assert.ok(r.bundle.warnings.some((w) => /member_number = 9876543210/.test(w)), r.bundle.warnings.join("\n"));
  assert.ok(r.bundle.warnings.some((w) => /pay_amount = 9876543210/.test(w)));
  assert.ok(r.bundle.skipped.badNumbers >= 5);
  const { rows: [pg] } = await db.execute(sql`SELECT reg_counter, member_counter FROM programs LIMIT 1`);
  assert.ok(pg.reg_counter < 2147483647 && pg.member_counter < 2147483647);
});

test("revert: a finished migration can be taken back (whole trust removed), only with the e-mail typed", async () => {
  const adminId = (await db.execute(sql`SELECT id, email FROM admins LIMIT 1`)).rows[0];
  await db.execute(sql`TRUNCATE migration_jobs`);
  await db.execute(sql`INSERT INTO migration_jobs (id, kind, target_admin_id, status, finished_at) VALUES ('J1', 'mgsf', ${adminId.id}, 'done', now())`);
  const info = await revertInfo("J1");
  assert.ok(info.members > 0);
  assert.equal(info.newMembers, 0);
  await assert.rejects(revertJob("J1", { confirm: "galat@x.in" }), /e-mail likhein/);
  const r = await revertJob("J1", { confirm: adminId.email.toUpperCase() });
  assert.equal(r.removed.members, info.members);
  assert.equal((await db.execute(sql`SELECT count(*)::int AS n FROM members`)).rows[0].n, 0);
  assert.equal((await db.execute(sql`SELECT count(*)::int AS n FROM accounts`)).rows[0].n, 0);
  await assert.rejects(revertJob("J1", { confirm: adminId.email }), /pehle hi hata/);
  await db.execute(sql`INSERT INTO migration_jobs (id, kind, target_admin_id, status, dry_run) VALUES ('J2', 'mgsf', 'X', 'done', true)`);
  await assert.rejects(revertInfo("J2"), /Dry run/);
});

test("Firebase Storage URL → bucket + path", () => {
  assert.deepEqual(storagePath("https://firebasestorage.googleapis.com/v0/b/my-app.appspot.com/o/members%2Fa%20b.jpg?alt=media&token=1"), { bucket: "my-app.appspot.com", path: "members/a b.jpg" });
  assert.deepEqual(storagePath("https://storage.googleapis.com/my-app.appspot.com/x/y.png"), { bucket: "my-app.appspot.com", path: "x/y.png" });
  assert.equal(storagePath("https://example.com/a.jpg"), null);
});
