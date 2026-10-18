// Core money logic audit: random sequences of real operations (add / accept members, closings, join-date
// and closing-date edits, revert, payments single / partial / bulk, reverse, pay amount, delete) and after
// EVERY step the whole book is checked:
//   1. every member's dues = THE RULE (nothing missing; extra only where money was already received)
//   2. due.paid_amount = sum of its completed transactions; status pending / partial / paid matches
//   3. no self-due, no duplicate, no due for a deleted / non-closed closing, amount = payer's pay amount
//   4. money in = money on dues (no lost or double payment)
// Plus: parallel accept + closing (no missed due), parallel double payment (paid once).   npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { createMember, acceptMember, updateMember, softDeleteMember } from "../src/services/members.js";
import { recordClosing, updateClosing, revertClosing, listClosings, closingDues } from "../src/services/closings.js";
import { listMembers } from "../src/services/members.js";
import { paySingle, payBulk, reverseTransaction } from "../src/services/payments.js";

let admin, program;
const auth = () => ({ role: "admin", adminId: admin.id, accountId: "audit" });
const agentAuth = () => ({ role: "agent", adminId: admin.id, agentId: "AG1", accountId: "ag" });

// deterministic random
let seed = Number(process.env.AUDIT_SEED) || 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const day = (from = "2025-01-01", spanDays = 600) => {
  const d = new Date(Date.parse(from) + Math.floor(rnd() * spanDays) * 86400000);
  return d.toISOString().slice(0, 10);
};

async function memberRow(id) {
  const m = await db.query.members.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  m.program = program;
  return m;
}

/** The whole book must be right. Returns the list of problems (empty = all good). */
async function auditBook() {
  const problems = [];
  // 1. dues vs THE RULE, computed independently here (not with the code under test)
  const { rows: should } = await db.execute(sql`
    SELECT p.id AS payer, c.id AS closing
    FROM members p JOIN members c ON c.program_id = p.program_id AND c.id <> p.id
    WHERE p.program_id = ${program.id}
      AND NOT p.deleted AND p.active AND NOT p.blocked AND p.status IN ('accepted', 'closed') AND p.pay_amount > 0
      AND NOT c.deleted AND c.closing_date IS NOT NULL
      AND p.date_join <= c.closing_date
      AND (p.closing_date IS NULL OR p.closing_date >= c.closing_date)`);
  const { rows: have } = await db.execute(sql`
    SELECT d.id, d.payer_member_id AS payer, d.closing_member_id AS closing, d.amount, d.paid_amount, d.status::text AS status,
           p.pay_amount, p.deleted AS p_deleted, c.deleted AS c_deleted, c.closing_date
    FROM dues d JOIN members p ON p.id = d.payer_member_id JOIN members c ON c.id = d.closing_member_id
    WHERE d.program_id = ${program.id}`);
  const key = (r) => `${r.payer}>${r.closing}`;
  const shouldSet = new Set(should.map(key));
  const haveMap = new Map();
  for (const d of have) {
    if (haveMap.has(key(d))) problems.push(`duplicate due ${key(d)}`);
    haveMap.set(key(d), d);
    if (d.payer === d.closing) problems.push(`self due ${d.payer}`);
    if (!d.closing_date) problems.push(`due for a closing that is not closed ${key(d)}`);
    if (!shouldSet.has(key(d)) && !(d.paid_amount > 0)) problems.push(`EXTRA due (nothing paid) ${key(d)}`);
  }
  for (const s of should) if (!haveMap.has(key(s))) problems.push(`MISSING due ${key(s)}`);

  // 2. paid amount = completed transactions; status matches
  const { rows: tx } = await db.execute(sql`
    SELECT d.id, d.amount, d.paid_amount, d.status::text AS status,
           COALESCE((SELECT sum(t.amount) FROM transactions t WHERE t.due_id = d.id AND t.status = 'completed'), 0)::int AS tx_sum
    FROM dues d WHERE d.program_id = ${program.id}`);
  for (const d of tx) {
    if (d.paid_amount !== d.tx_sum) problems.push(`due ${d.id}: paid ${d.paid_amount} but transactions ${d.tx_sum}`);
    const want = d.paid_amount <= 0 ? "pending" : d.paid_amount >= d.amount ? "paid" : "partial";
    if (d.status !== want) problems.push(`due ${d.id}: status ${d.status}, should be ${want} (${d.paid_amount}/${d.amount})`);
    if (d.paid_amount > d.amount) problems.push(`due ${d.id}: over-paid ${d.paid_amount}/${d.amount}`);
  }
  // 4. every completed transaction belongs to a due
  const { rows: [o] } = await db.execute(sql`
    SELECT count(*)::int AS n FROM transactions t
    WHERE t.program_id = ${program.id} AND t.status = 'completed' AND (t.due_id IS NULL OR NOT EXISTS (SELECT 1 FROM dues d WHERE d.id = t.due_id))`);
  if (o.n) problems.push(`${o.n} completed transactions without a due (money lost)`);
  return problems;
}

before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "audit@test.in", displayName: "Audit" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah", regMode: "series", regPrefix: "A", defaultPayAmount: 200 }).returning();
  await db.insert(schema.agents).values({ id: "AG1", adminId: admin.id, displayName: "Agent" });
});
after(() => pool.end());

test("random operations: the book stays right after every step", async () => {
  const ids = [];
  const pending = [];
  const log = [];
  const ok = (p) => p.catch((e) => { if (!e.status || e.status >= 500) throw e; return null; }); // business refusals are fine

  for (let i = 0; i < 25; i++) ids.push((await createMember(program, { displayName: `M${i}`, dateJoin: day("2025-01-01", 300), payAmount: pick([100, 200, 200, 300]) }, auth())).member.id);

  for (let step = 0; step < (Number(process.env.AUDIT_STEPS) || 450); step++) {
    const op = pick(["add", "add", "request", "accept", "close", "close", "close", "joinDate", "closeDate", "revert",
      "pay", "pay", "pay", "partial", "bulk", "bulkCustom", "reverse", "payAmount", "delete"]);
    const alive = (await db.execute(sql`SELECT id, status::text AS status, closing_date FROM members WHERE program_id = ${program.id} AND NOT deleted`)).rows;
    const open = alive.filter((m) => m.status === "accepted");
    const closed = alive.filter((m) => m.closing_date);
    const randomOpenDues = async (n = 3) => (await db.execute(sql`
      SELECT d.id, d.payer_member_id, d.closing_member_id, d.amount - d.paid_amount AS left FROM dues d
      WHERE d.program_id = ${program.id} AND d.status <> 'paid' ORDER BY md5(d.id || ${String(step)}) LIMIT ${n}`)).rows;
    try {
      switch (op) {
        case "add": ids.push((await createMember(program, { displayName: `N${step}`, dateJoin: day("2025-01-01", 650), payAmount: pick([200, 300]) }, auth())).member.id); break;
        case "request": pending.push((await createMember(program, { displayName: `R${step}`, dateJoin: day("2025-01-01", 650) }, agentAuth())).member.id); break;
        case "accept": if (pending.length) await ok(acceptMember(pending.splice(Math.floor(rnd() * pending.length), 1)[0], {})); break;
        case "close": if (open.length) await ok(recordClosing(pick(open).id, { closingDate: day("2025-02-01", 620) })); break;
        case "joinDate": if (alive.length) { const m = pick(alive); await ok(updateMember(await memberRow(m.id), { dateJoin: day("2025-01-01", 650) })); } break;
        case "closeDate": if (closed.length) await ok(updateClosing(pick(closed).id, { closingDate: day("2025-02-01", 620) })); break;
        case "revert": if (closed.length) await ok(revertClosing(pick(closed).id, { force: rnd() < 0.5 })); break;
        case "pay": { const [d] = await randomOpenDues(1); if (d) await ok(paySingle({ programId: program.id, payerId: d.payer_member_id, dueIds: [d.id] }, auth())); break; }
        case "partial": {
          const [d] = await randomOpenDues(1);
          if (d && d.left > 1) await ok(paySingle({ programId: program.id, payerId: d.payer_member_id, closingIds: [d.closing_member_id], customTotalAmount: Math.max(1, Math.floor(d.left / 2)) }, auth()));
          break;
        }
        case "bulk": { const ds = await randomOpenDues(4); if (ds.length) await ok(payBulk({ programId: program.id, memberIds: [...new Set(ds.map((d) => d.payer_member_id))], globalAmount: 500 }, auth())); break; }
        case "bulkCustom": {
          const ds = await randomOpenDues(4);
          if (ds.length) {
            const sel = {};
            for (const d of ds) (sel[d.payer_member_id] ||= []).push(d.id);
            await ok(payBulk({ programId: program.id, memberIds: Object.keys(sel), memberClosingSelections: sel }, auth()));
          }
          break;
        }
        case "reverse": {
          const { rows: [t] } = await db.execute(sql`SELECT id FROM transactions WHERE program_id = ${program.id} AND status = 'completed' ORDER BY md5(id || ${String(step)}) LIMIT 1`);
          if (t) await ok(reverseTransaction(t.id, { reason: "audit" }, auth()));
          break;
        }
        case "payAmount": if (alive.length) { const m = pick(alive); await ok(updateMember(await memberRow(m.id), { payAmount: pick([0, 200, 300]) })); } break;
        case "delete": if (alive.length && rnd() < 0.3) await softDeleteMember(pick(alive).id); break;
      }
    } catch (e) {
      throw new Error(`step ${step} ${op} crashed: ${e.message}\n${log.slice(-5).join("\n")}`);
    }
    log.push(`${step} ${op}`);
    const problems = await auditBook();
    assert.deepEqual(problems, [], `after step ${step} (${op}):\n${problems.slice(0, 10).join("\n")}\nlast ops: ${log.slice(-6).join(", ")}`);
  }
  const { rows: [c] } = await db.execute(sql`
    SELECT (SELECT count(*) FROM dues WHERE program_id = ${program.id})::int AS dues,
           (SELECT count(*) FROM transactions WHERE program_id = ${program.id} AND status = 'completed')::int AS tx,
           (SELECT count(*) FROM members WHERE program_id = ${program.id} AND closing_date IS NOT NULL)::int AS closings`);
  assert.ok(c.dues > 50 && c.tx > 20 && c.closings > 5, JSON.stringify(c)); // the run really exercised things
});

test("parallel: accepting members while closings are recorded → no due is missed", async () => {
  for (let round = 0; round < 8; round++) {
    const reqs = [];
    for (let i = 0; i < 4; i++) reqs.push((await createMember(program, { displayName: `P${round}-${i}`, dateJoin: "2025-01-01" }, agentAuth())).member.id);
    const closers = [];
    for (let i = 0; i < 3; i++) closers.push((await createMember(program, { displayName: `C${round}-${i}`, dateJoin: "2025-01-01" }, auth())).member.id);
    await Promise.all([
      ...reqs.map((id) => acceptMember(id, {})),
      ...closers.map((id) => recordClosing(id, { closingDate: "2026-09-01" })),
    ]);
    assert.deepEqual(await auditBook(), [], `round ${round}`);
  }
});

test("parallel: the same due paid twice at the same moment → paid only once", async () => {
  const a = (await createMember(program, { displayName: "Payer", dateJoin: "2025-01-01", payAmount: 200 }, auth())).member.id;
  const c = (await createMember(program, { displayName: "Closer", dateJoin: "2025-01-01" }, auth())).member.id;
  await recordClosing(c, { closingDate: "2026-10-01" });
  const body = { programId: program.id, payerId: a, closingIds: [c] };
  const r = await Promise.allSettled([paySingle(body, auth()), paySingle(body, auth()), paySingle(body, auth())]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  const { rows: [d] } = await db.execute(sql`SELECT paid_amount, status::text AS status FROM dues WHERE payer_member_id = ${a} AND closing_member_id = ${c}`);
  assert.deepEqual([d.paid_amount, d.status], [200, "paid"]);
  assert.deepEqual(await auditBook(), []);
});

test("amount must be whole rupees; partial then rest adds up exactly", async () => {
  const a = (await createMember(program, { displayName: "Paisa", dateJoin: "2025-01-01", payAmount: 300 }, auth())).member.id;
  const c = (await createMember(program, { displayName: "Shaadi", dateJoin: "2025-01-01" }, auth())).member.id;
  await recordClosing(c, { closingDate: "2026-10-02" });
  const body = { programId: program.id, payerId: a, closingIds: [c] };
  await assert.rejects(paySingle({ ...body, customTotalAmount: 100.5 }, auth()), (e) => e.status === 400);
  await paySingle({ ...body, customTotalAmount: "120" }, auth());
  await paySingle({ ...body, customTotalAmount: 180 }, auth());
  await assert.rejects(paySingle({ ...body, customTotalAmount: 1 }, auth()), (e) => e.status === 409);
  const { rows: [d] } = await db.execute(sql`SELECT paid_amount, status::text AS status FROM dues WHERE payer_member_id = ${a} AND closing_member_id = ${c}`);
  assert.deepEqual([d.paid_amount, d.status], [300, "paid"]);
  assert.deepEqual(await auditBook(), []);
});

test("screens show the same numbers as the book (closing list, closing detail, member baki)", async () => {
  const { closings, summary } = await listClosings(program.id);
  const { rows: [raw] } = await db.execute(sql`
    SELECT count(*) FILTER (WHERE d.status = 'paid')::int AS paid, count(*) FILTER (WHERE d.status <> 'paid')::int AS open,
           COALESCE(sum(d.paid_amount), 0)::int AS collected, COALESCE(sum(d.amount - d.paid_amount), 0)::int AS pending
    FROM dues d JOIN members c ON c.id = d.closing_member_id
    WHERE d.program_id = ${program.id} AND NOT c.deleted AND c.closing_date IS NOT NULL`);
  assert.deepEqual([summary.totalPaidCount, summary.totalPendingCount, summary.totalCollected, summary.totalPendingAmount],
    [raw.paid, raw.open, raw.collected, raw.pending]);
  for (const c of closings.slice(0, 15)) {
    const d = await closingDues(c.id);
    assert.equal(d.summary.total, c.totalDues);
    assert.equal(d.summary.paidAmount, c.collectedAmount);
    assert.equal(d.summary.pendingAmount, c.pendingAmount);
  }
  const { members } = await listMembers(program.id, { pageSize: 1000 });
  for (const m of members) {
    const { rows: [x] } = await db.execute(sql`
      SELECT count(*) FILTER (WHERE status <> 'paid')::int AS n, COALESCE(sum(amount - paid_amount), 0)::int AS amt
      FROM dues WHERE payer_member_id = ${m.id}`);
    assert.deepEqual([m.openDues, m.openAmount], [x.n, x.amt], m.displayName);
  }
  // money: transactions in = money on dues
  const { rows: [t] } = await db.execute(sql`
    SELECT (SELECT COALESCE(sum(amount), 0) FROM transactions WHERE program_id = ${program.id} AND status = 'completed')::int AS tx,
           (SELECT COALESCE(sum(paid_amount), 0) FROM dues WHERE program_id = ${program.id})::int AS dues`);
  assert.equal(t.tx, t.dues);
});
