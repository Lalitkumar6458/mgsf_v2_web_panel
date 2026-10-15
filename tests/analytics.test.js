// Dashboard numbers: exclusive member buckets, agent-wise totals, money.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { programAnalytics } from "../src/services/analytics.js";

let admin, program;
before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "a@test.in", displayName: "T" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah" }).returning();
  await db.insert(schema.agents).values([
    { id: "A1", adminId: admin.id, displayName: "Ramesh" },
    { id: "A2", adminId: admin.id, displayName: "Idle Agent" },
  ]);
  const base = { programId: program.id, dateJoin: "2026-01-01" };
  await db.insert(schema.members).values([
    { ...base, id: "m1", agentId: "A1", status: "accepted", gender: "male" },                    // active
    { ...base, id: "m2", agentId: "A1", status: "accepted", active: false },                     // inactive
    { ...base, id: "m3", agentId: "A1", status: "accepted", blocked: true },                     // blocked
    { ...base, id: "m4", agentId: "A1", status: "accepted", closingDate: "2026-03-01" },         // closed
    { ...base, id: "m5", agentId: null, status: "accepted", gender: "female" },                  // active, no agent
    { ...base, id: "m6", agentId: "A1", status: "pending" },                                     // request
    { ...base, id: "m7", agentId: "A1", status: "rejected" },
    { ...base, id: "m8", agentId: "A1", status: "accepted", deleted: true },                     // not counted
    { ...base, id: "m9", agentId: "A1", status: "accepted", blocked: true, closingDate: "2026-04-01" }, // closed wins
  ]);
  await db.insert(schema.dues).values([
    { id: "d1", programId: program.id, closingMemberId: "m4", payerMemberId: "m1", amount: 200, paidAmount: 200, status: "paid" },
    { id: "d2", programId: program.id, closingMemberId: "m4", payerMemberId: "m5", amount: 200, paidAmount: 50, status: "partial" },
  ]);
  await db.insert(schema.transactions).values([
    { id: "t1", programId: program.id, transactionNumber: "T1", batchId: "b1", payerMemberId: "m1", closingMemberId: "m4", amount: 200, paymentMethod: "cash", paymentDate: "2026-03-05" },
    { id: "t2", programId: program.id, transactionNumber: "T2", batchId: "b2", payerMemberId: "m5", closingMemberId: "m4", amount: 50, paymentMethod: "online", paymentDate: "2026-03-06" },
    { id: "t3", programId: program.id, transactionNumber: "T3", batchId: "b3", payerMemberId: "m5", amount: 999, paymentDate: "2026-03-06", status: "reversed" },
  ]);
});
after(() => pool.end());

test("member buckets are exclusive and add up", async () => {
  const { members: m } = await programAnalytics(program.id);
  assert.deepEqual(
    { active: m.active, inactive: m.inactive, blocked: m.blocked, closed: m.closed, pending: m.pending, rejected: m.rejected, deleted: m.deleted, onBooks: m.onBooks },
    { active: 2, inactive: 1, blocked: 1, closed: 2, pending: 1, rejected: 1, deleted: 1, onBooks: 6 });
  assert.equal(m.activeMale, 1);
  assert.equal(m.activeFemale, 1);
});

test("money: reversed payments ignored, outstanding and rate", async () => {
  const { money } = await programAnalytics(program.id);
  assert.equal(money.collected, 250);
  assert.equal(money.cash, 200);
  assert.equal(money.online, 50);
  assert.equal(money.outstanding, 150);
  assert.equal(money.billed, 400);
  assert.equal(money.collectionRate, 62.5);
});

test("agent-wise rows, incl. no-agent and idle agents; agent filter", async () => {
  const { agents } = await programAnalytics(program.id);
  const a1 = agents.find((a) => a.agentId === "A1");
  assert.deepEqual([a1.total, a1.active, a1.inactive, a1.blocked, a1.closed, a1.pending], [5, 1, 1, 1, 2, 1]);
  assert.equal(a1.collected, 200);
  const none = agents.find((a) => a.agentId === null);
  assert.equal(none.total, 1);
  assert.equal(none.outstanding, 150);
  assert.ok(agents.find((a) => a.agentId === "A2" && a.total === 0), "idle agent listed");

  const only = await programAnalytics(program.id, { agentId: "A1" });
  assert.equal(only.members.onBooks, 5);
  assert.equal(only.money.collected, 200);
  assert.deepEqual(only.agents.map((a) => a.agentId), ["A1"]);
});

test("closed members list: filter by the closed member's agent / group, agent name included", async () => {
  const { listClosings } = await import("../src/services/closings.js");
  const all = await listClosings(program.id);
  assert.deepEqual(all.closings.map((c) => c.id).sort(), ["m4", "m9"]);
  const m4 = all.closings.find((c) => c.id === "m4");
  assert.equal(m4.agentName, "Ramesh");
  assert.equal(m4.collectedAmount, 250);
  assert.equal(m4.pendingAmount, 150);
  assert.equal((await listClosings(program.id, { closingAgentId: "A1" })).closings.length, 2);
  assert.equal((await listClosings(program.id, { closingAgentId: "A2" })).closings.length, 0);
  assert.equal((await listClosings(program.id, { closingAgentId: "none" })).closings.length, 0);
  assert.equal((await listClosings(program.id, { closingGroupId: "none" })).closings.length, 2);
  assert.equal((await listClosings(program.id, { from: "2026-03-15" })).closings.length, 1);
});

test("receipts: data from DB by status / agent / group, size estimate, parts keep receipt numbers", async () => {
  const { receiptMembers, receiptEstimate } = await import("../src/services/reports.js");
  const { splitParts } = await import("../src/services/receiptJobs.js");
  const pending = await receiptMembers(program.id, { status: "pending" });
  assert.deepEqual(pending.map((m) => [m.memberId, m.marriages.length, m.marriages[0].amount]), [["m5", 1, 150]]); // partial → open part
  assert.equal(pending[0].agentName, "Admin");
  const paid = await receiptMembers(program.id, { status: "paid" });
  assert.deepEqual(paid.map((m) => m.memberId), ["m1"]);
  assert.equal(paid[0].agentName, "Ramesh");
  assert.equal(paid[0].marriages[0].closingRegNo, "NA");
  assert.equal((await receiptMembers(program.id, { status: "paid", agentId: "A2" })).length, 0);
  assert.equal((await receiptMembers(program.id, { status: "paid", memberIds: [] })).length, 0);
  assert.equal((await receiptMembers(program.id, { status: "paid", from: "2026-03-02" })).length, 0);
  assert.deepEqual(await receiptEstimate(program.id, { status: "pending" }), { members: 1, rows: 1, pages: 1 });

  // 25 payers × 23 rows (3 pages each) → parts of ≤ 30 pages, payer never split
  const fake = Array.from({ length: 25 }, (_, i) => ({ memberId: "p" + i, marriages: Array(23).fill({}) }));
  const parts = splitParts(fake, 30);
  assert.deepEqual(parts.map((p) => p.members.length), [10, 10, 5]);
  assert.deepEqual(parts.map((p) => p.pages), [30, 30, 15]);
});
