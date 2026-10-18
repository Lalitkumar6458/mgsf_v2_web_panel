// Mobile app server side: app settings, access rules (agent / member family), member account,
// agent overview / members / closings, requests, list PDF.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { normalizeAppSettings, compareVersions, publicAppStatus } from "../src/lib/appSettings.js";
import { buildListReport } from "../src/lib/pdf/listReport.js";
import {
  saveAppSettings, appStatus, paymentInfo, memberFor, memberDetail, family, familyIds,
  agentOverview, agentMembers, agentClosings, agentClosing, agentBatch, agentRequests, appMemberCount, getAppSettings,
} from "../src/services/mobileApp.js";
import { saveTrustFeatures } from "../src/services/features.js";

let admin, program;
const agent = { role: "agent", agentId: "A1", accountId: "accA1", displayName: "Ramesh" };
const memberAuth = { role: "member", memberId: "p1", accountId: "accP1" };
before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "app@test.in", trustInfo: { name: "App Trust", contact: "9876500000" } }).returning();
  agent.adminId = admin.id;
  memberAuth.adminId = admin.id;
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah", ageGroups: [{ id: "g1", startAge: 18, endAge: 40, payAmount: 200, joinFees: 500 }] }).returning();
  await db.insert(schema.agents).values([{ id: "A1", adminId: admin.id, displayName: "Ramesh" }, { id: "A2", adminId: admin.id, displayName: "Other" }]);
  await db.insert(schema.closingGroups).values({ id: "G1", programId: program.id, name: "Jan" });
  const m = (id, extra) => ({ id, programId: program.id, dateJoin: "2026-01-01", status: "accepted", payAmount: 200, displayName: id, ...extra });
  await db.insert(schema.members).values([
    m("c1", { closingDate: "2026-02-01", closingGroupId: "G1", agentId: "A2" }),
    m("c2", { closingDate: "2026-03-01", agentId: "A2" }),
    m("p1", { agentId: "A1", phone: "+91 98765 43210", registrationNumber: "R1", joinFees: 500, joinFeesPaidAmount: 100 }),
    m("p2", { agentId: "A1", phone: "9876543210", registrationNumber: "R2" }),   // same family
    m("p3", { agentId: "A2", phone: "9000000000" }),
    m("req", { agentId: "A1", status: "rejected", addedBy: "agent", extra: { statusReason: "photo saaf nahi" } }),
  ]);
  await db.insert(schema.dues).values([
    { id: "d1", programId: program.id, closingMemberId: "c1", payerMemberId: "p1", amount: 200, paidAmount: 200, status: "paid", dueDate: "2026-03-01", paidDate: "2026-02-20" },
    { id: "d2", programId: program.id, closingMemberId: "c2", payerMemberId: "p1", amount: 200, dueDate: "2026-04-01" },
    { id: "d3", programId: program.id, closingMemberId: "c1", payerMemberId: "p2", amount: 200, paidAmount: 200, status: "paid", dueDate: "2026-03-01", paidDate: "2026-03-10" },
    { id: "d4", programId: program.id, closingMemberId: "c1", payerMemberId: "p3", amount: 200, dueDate: "2026-03-01" },
  ]);
  await db.insert(schema.transactions).values([
    { id: "t1", programId: program.id, transactionNumber: "TRX-1", batchId: "B1", payerMemberId: "p1", closingMemberId: "c1", dueId: "d1", amount: 200, paymentDate: "2026-02-20" },
  ]);
});
after(() => pool.end());

test("app settings: normalised, versions compared, public part only", async () => {
  const s = normalizeAppSettings({ maintenance: { on: true }, update: { latestVersion: "2.1", minVersion: "x" }, payment: { upiId: "bad", members: true, steps: "a\n\nb" } });
  assert.equal(s.update.minVersion, "");
  assert.equal(s.payment.upiId, "");
  assert.deepEqual(s.payment.steps, ["a", "b"]);
  assert.equal(compareVersions("2.0.0", "2.0.10"), -1);
  assert.equal(compareVersions("2.1", "2.1.0"), 0);
  assert.deepEqual(Object.keys(publicAppStatus(s)), ["maintenance", "update", "payment"]);
  await saveAppSettings(admin.id, { payment: { members: true, upiId: "trust@sbi" }, maintenance: { on: false } });
  const st = await appStatus();
  assert.deepEqual(st.payment, { members: true, agents: false });
  const p = await paymentInfo(memberAuth, { amount: 400, note: "Reg R1" });
  assert.match(p.upiLink, /^upi:\/\/pay\?pa=trust@sbi&.*am=400\.00/);
  assert.match(p.qrDataUrl, /^data:image\/png/);
  await assert.rejects(paymentInfo(agent, { amount: 1 }), /बंद/);
  await saveAppSettings(admin.id, { payment: { members: true, agents: true, upiId: "" } });
  assert.deepEqual((await appStatus()).payment, { members: false, agents: false });   // on, but no UPI/QR/bank
  await saveAppSettings(admin.id, { payment: { members: true, agents: false, upiId: "trust@sbi" } });
});

test("access: agent sees only his members; member sees himself + same-mobile family", async () => {
  assert.equal((await memberFor(agent, "p1")).id, "p1");
  await assert.rejects(memberFor(agent, "p3"), /आपका नहीं/);
  assert.deepEqual(await familyIds(memberAuth), ["p1", "p2"]);
  assert.equal((await memberFor(memberAuth, "p2")).id, "p2");
  await assert.rejects(memberFor(memberAuth, "p3"));
  const f = await family(memberAuth);
  assert.equal(f.members.length, 2);
  assert.equal(f.members[0].dueAmount, 200);
});

test("member account: timing, overdue, receipts, joining fee", async () => {
  const d = await memberDetail("p1");
  assert.equal(d.summary.paidAmount, 200);
  assert.equal(d.summary.pendingAmount, 200);
  assert.equal(d.summary.onTimeCount, 1);
  const pend = d.timeline.find((r) => r.id === "d2");
  assert.equal(pend.overdue, true);
  assert.equal(pend.seq, 2);
  assert.equal(d.timeline.find((r) => r.id === "d1").batchName, "Jan");
  assert.equal(d.receipts[0].receiptNo, "TRX-1");
  assert.deepEqual(d.joinFee, { total: 500, paid: 100, due: 400, done: false });
  assert.match(d.member.aadhaarNo, /^$|XXXX/);
  const late = await memberDetail("p2");
  assert.equal(late.summary.lateCount, 1);
});

test("agent overview / members / closings / group / requests", async () => {
  const o = await agentOverview(agent, program.id);
  assert.equal(o.current.members, 2);
  assert.equal(o.current.dueAmount, 200);
  assert.equal(o.current.feeDue, 400);
  assert.deepEqual(o.requests, { pending: 0, rejected: 1, approved: 0 });
  const due = await agentMembers(agent, { programId: program.id, f: "due" });
  assert.deepEqual(due.members.map((m) => m.id), ["p1"]);
  assert.equal(due.totals.dueAmount, 200);
  const c = await agentClosings(agent, { programId: program.id });
  const c1 = c.closings.find((x) => x.id === "c1");
  assert.deepEqual([c1.members, c1.paidCount, c1.pendingCount], [2, 2, 0]); // p3 (other agent) not counted
  assert.equal(c.batches[0].id, "G1");
  const one = await agentClosing(agent, "c2");
  assert.equal(one.totals.pendingAmount, 200);
  const g = await agentBatch(agent, "G1");
  assert.equal(g.rows.length, 2);
  assert.equal(g.rows.find((r) => r.id === "p1").totalDueAmount, 200);
  const r = await agentRequests(agent);
  assert.equal(r.requests.find((x) => x.id === "req").rejectReason, "photo saaf nahi");
  await assert.rejects(agentOverview(memberAuth, program.id), /एजेंट/);
});

test("list PDF builds (several pages, Hindi text)", async () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ i: i + 1, name: `सदस्य ${i}`, amount: "₹200" }));
  const buf = await buildListReport({ TrustData: { name: "ट्रस्ट" }, title: "बकाया सूची", columns: [{ key: "i", label: "क्र.", w: 30 }, { key: "name", label: "नाम", w: 200 }, { key: "amount", label: "राशि", w: 60, align: "right" }], rows, total: { name: "कुल", amount: "₹14,000" } });
  assert.equal(buf.subarray(0, 4).toString(), "%PDF");
  assert.ok((buf.toString("latin1").match(/\/Type \/Page\b/g) || []).length >= 3);
});

test("feature control: member / agent login and app payment reach the app", async () => {
  await saveAppSettings(admin.id, { payment: { members: true, agents: true, upiId: "trust@sbi" } });
  let st = await appStatus();
  assert.deepEqual(st.login, { member: true, agent: true, message: "" });
  assert.deepEqual(st.payment, { members: true, agents: true });

  await saveTrustFeatures(admin.id, { flags: { memberLogin: false, appPayment: false } });
  st = await appStatus();
  assert.deepEqual([st.login.member, st.login.agent], [false, true]);       // app shows only "एजेंट"
  assert.deepEqual(st.payment, { members: false, agents: false });            // no "भुगतान करें"
  await assert.rejects(paymentInfo(memberAuth, { amount: 100 }), /बंद/);

  await saveTrustFeatures(admin.id, { flags: {}, active: false, message: "Fees baki" });
  st = await appStatus();
  assert.deepEqual(st.login, { member: false, agent: false, message: "Fees baki" });

  await saveTrustFeatures(admin.id, { flags: {} });
  assert.deepEqual((await appStatus()).login, { member: true, agent: true, message: "" });
});

test("member count in the app: off by default, per login type, yojna / asli / % / fixed", async () => {
  // members on books in this yojna: c1 c2 p1 p2 p3 (accepted / closed) = 5; "req" (rejected) not counted
  assert.deepEqual(await appMemberCount(agent), { show: false });
  const base = await getAppSettings(admin.id);
  await saveAppSettings(admin.id, { ...base, memberCount: { agents: true, members: false, source: "actual" } });
  assert.deepEqual((await appMemberCount(agent)).programs.map((p) => p.count), [5]);
  assert.deepEqual(await appMemberCount(memberAuth), { show: false });

  // same as the yojna's own setting (panel)
  await db.execute(sql`UPDATE programs SET extra = jsonb_build_object('countDisplay', jsonb_build_object('mode', 'percent', 'percent', 200)) WHERE id = ${program.id}`);
  await saveAppSettings(admin.id, { ...base, memberCount: { agents: true, members: true, source: "yojna" } });
  assert.equal((await appMemberCount(agent)).programs[0].count, 10);
  assert.equal((await appMemberCount(memberAuth)).programs[0].count, 10);

  // app's own: percent, then fixed (starts at the number, then + new members)
  await saveAppSettings(admin.id, { ...base, memberCount: { agents: true, members: true, source: "custom", custom: { [program.id]: { mode: "percent", percent: 60 }, bogus: { mode: "fixed", fixed: 9 } } } });
  assert.equal((await appMemberCount(agent)).programs[0].count, 3);
  assert.equal((await getAppSettings(admin.id)).memberCount.custom.bogus, undefined);       // not this trust's yojna
  await saveAppSettings(admin.id, { ...base, memberCount: { agents: true, members: true, source: "custom", custom: { [program.id]: { mode: "fixed", fixed: 1000 } } } });
  assert.equal((await appMemberCount(agent)).programs[0].count, 1000);
  await db.insert(schema.members).values({ id: "new1", programId: program.id, dateJoin: "2026-05-01", status: "accepted", displayName: "N" });
  assert.equal((await appMemberCount(agent)).programs[0].count, 1001);
  // saving again with the same number keeps the starting point
  await saveAppSettings(admin.id, { ...base, memberCount: (await getAppSettings(admin.id)).memberCount });
  assert.equal((await appMemberCount(agent)).programs[0].count, 1001);

  // "Member count display" switched off for the trust → real count
  assert.equal((await appMemberCount({ ...agent, features: { countDisplay: false } })).programs[0].count, 6);
  await db.execute(sql`DELETE FROM members WHERE id = 'new1'`);
  await saveAppSettings(admin.id, base);
});
