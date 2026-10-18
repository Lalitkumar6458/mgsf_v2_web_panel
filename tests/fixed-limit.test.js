// Fixed rakam (seema): a member pays at most his limit in all for closings.   npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { createMember, updateMember, softDeleteMember } from "../src/services/members.js";
import { recordClosing, revertClosing, updateClosing, payerDuesCheck } from "../src/services/closings.js";
import { paySingle, reverseTransaction, openDuesFor } from "../src/services/payments.js";
import { addAdvance, advanceBalance } from "../src/services/advances.js";
import { setFixedLimit, limitStatus } from "../src/services/fixedLimit.js";
import { memberDues } from "../src/services/reports.js";

let admin, program;
const auth = () => ({ role: "admin", adminId: admin.id, accountId: "office", displayName: "Office" });
const add = async (name, extra = {}) => (await createMember(program, { displayName: name, dateJoin: "2026-01-01", payAmount: 200, ...extra }, auth())).member.id;
const member = async (id) => db.query.members.findFirst({ where: (m, { eq }) => eq(m.id, id) });
/** payer's dues in closing order: "C1:200/0:pending" */
const book = async (payer) => (await db.execute(sql`
  SELECT c.display_name AS c, d.amount, d.paid_amount AS paid, d.status::text AS s
  FROM dues d JOIN members c ON c.id = d.closing_member_id WHERE d.payer_member_id = ${payer}
  ORDER BY c.closing_date, c.closing_at`)).rows.map((r) => `${r.c}:${r.amount}/${r.paid}:${r.s}`);
let day = 0;
/** join date = the next closing day → he owes only closings made from now on in this test */
const fresh = (extra = {}) => ({ dateJoin: `2026-03-${String(day + 1).padStart(2, "0")}`, ...extra });
const close = async (id) => recordClosing(id, { closingDate: `2026-03-${String(++day).padStart(2, "0")}` });

before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "lim@test.in", displayName: "Lim" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah", regMode: "series", regPrefix: "L" }).returning();
});
after(() => pool.end());

test("limit ₹500, kist ₹200: dues 200, 200, 100 — then nothing more", async () => {
  const P = await add("P", { fixedLimit: 500 });
  const C = [];
  for (let i = 1; i <= 4; i++) C.push(await add(`C${i}`));
  for (const c of C) await close(c);
  assert.deepEqual(await book(P), ["C1:200/0:pending", "C2:200/0:pending", "C3:100/0:pending"]);
  const st = await limitStatus(P);
  assert.deepEqual([st.limit, st.paid, st.owed, st.left, st.advanceRoom], [500, 0, 500, 500, 500]);
  // "Correct payments" must not call C4 missing
  assert.equal((await payerDuesCheck(P)).missing.length, 0);
  const s = (await memberDues(P)).summary;
  assert.deepEqual([s.fixedLimit, s.pendingAmount, s.limitLeft], [500, 500, 500]);
});

test("raise the limit → cut due grows back and the next closing comes; remove it → all full", async () => {
  const P = (await db.execute(sql`SELECT id FROM members WHERE display_name = 'P'`)).rows[0].id;
  const r = await updateMember(await member(P), { fixedLimit: 700 });
  assert.ok(r.success);
  assert.deepEqual(await book(P), ["C1:200/0:pending", "C2:200/0:pending", "C3:200/0:pending", "C4:100/0:pending"]);
  await updateMember(await member(P), { fixedLimit: null });
  assert.deepEqual(await book(P), ["C1:200/0:pending", "C2:200/0:pending", "C3:200/0:pending", "C4:200/0:pending"]);
  const { rows } = await db.execute(sql`SELECT count(*)::int AS n FROM dues WHERE payer_member_id = ${P} AND base_amount IS NOT NULL`);
  assert.equal(rows[0].n, 0);
  await updateMember(await member(P), { fixedLimit: 500 });
  assert.deepEqual(await book(P), ["C1:200/0:pending", "C2:200/0:pending", "C3:100/0:pending"]);
});

test("paid money is never cut: limit set below what he already paid → nothing more to pay", async () => {
  const Q = await add("Q", fresh());
  const D = [await add("D1"), await add("D2"), await add("D3")];
  for (const d of D) await close(d);
  await paySingle({ programId: program.id, payerId: Q, closingIds: [D[0], D[1]] }, auth());  // paid 400
  await paySingle({ programId: program.id, payerId: Q, closingIds: [D[2]], customTotalAmount: 50 }, auth()); // part
  await updateMember(await member(Q), { fixedLimit: 300 });
  const b = await book(Q);
  // D1, D2 paid (400 > 300, kept), D3: ₹50 paid stays and the due is closed at ₹50 → paid
  assert.equal(b.filter((x) => x.startsWith("D")).join(","), "D1:200/200:paid,D2:200/200:paid,D3:50/50:paid");
  assert.equal((await limitStatus(Q)).reached, true);
  const E = await add("E1"); await close(E);
  assert.ok(!(await book(Q)).some((x) => x.startsWith("E1")), "no due after limit reached");
  // raise to 1000 → D3 grows back to 200 (₹50 paid → partial) and E1 comes
  await updateMember(await member(Q), { fixedLimit: 1000 });
  const b2 = await book(Q);
  assert.ok(b2.includes("D3:200/50:partial"));
  assert.ok(b2.some((x) => x.startsWith("E1:200/0")));
});

test("closing reverted / deleted → the limit it used goes to the next closing", async () => {
  const R = await add("R", fresh({ fixedLimit: 400 }));
  const F = [await add("F1"), await add("F2"), await add("F3")];
  for (const f of F) await close(f);
  assert.deepEqual((await book(R)).filter((x) => x.startsWith("F")), ["F1:200/0:pending", "F2:200/0:pending"]);
  await revertClosing(F[0]);
  assert.deepEqual((await book(R)).filter((x) => x.startsWith("F")), ["F2:200/0:pending", "F3:200/0:pending"]);
  await softDeleteMember(F[1]);
  assert.deepEqual((await book(R)).filter((x) => x.startsWith("F")), ["F3:200/0:pending"]);
});

test("payment reversed → that due is open again inside the limit; later dues not over the limit", async () => {
  const S = await add("S", fresh({ fixedLimit: 300 }));
  const G = [await add("G1"), await add("G2")];
  for (const g of G) await close(g);
  assert.deepEqual((await book(S)).filter((x) => x.startsWith("G")), ["G1:200/0:pending", "G2:100/0:pending"]);
  const r = await paySingle({ programId: program.id, payerId: S, closingIds: [G[1]] }, auth());
  assert.equal(r.totalPaid, 100);
  const { rows: [t] } = await db.execute(sql`SELECT id FROM transactions WHERE batch_id = ${r.batchId}`);
  await reverseTransaction(t.id, { reason: "galti" }, auth());
  assert.deepEqual((await book(S)).filter((x) => x.startsWith("G")), ["G1:200/0:pending", "G2:100/0:pending"]);
  const all = (await limitStatus(S));
  assert.ok(all.paid + all.owed <= 300);
});

test("advance only up to what is left of the limit", async () => {
  const T = await add("T", { fixedLimit: 1000 });
  await addAdvance(T, { amount: 600 }, auth());
  await assert.rejects(addAdvance(T, { amount: 500 }, auth()), /sirf ₹400/);
  await addAdvance(T, { amount: 400 }, auth());
  await assert.rejects(addAdvance(T, { amount: 1 }, auth()), /poori ho chuki/);
});

test("bulk: 5 members, ₹15,200 fixed + advance filled → after paying, nothing more ever", async () => {
  const ids = [];
  for (let i = 1; i <= 5; i++) ids.push(await add(`B${i}`, fresh({ payAmount: 3000 })));
  const H = await add("H1"); await close(H); // each owes 3000 now
  const r = await setFixedLimit(program.id, { memberIds: ids, fixedLimit: 15200, advance: { method: "cash" } }, auth());
  assert.equal(r.count, 5);
  assert.equal(r.advanceTotal, 5 * 15200);
  for (const id of ids) assert.equal(await advanceBalance(id), 15200);
  // 6 more closings: 3000 × 5 = 15000, the 6th closing only 200 is left, the rest nothing
  const K = [];
  for (let i = 1; i <= 6; i++) { K.push(await add(`K${i}`)); await close(K.at(-1)); }
  const o = await openDuesFor(program.id, ids);
  for (const id of ids) {
    const total = o.members[id].dues.reduce((a, d) => a + d.remaining, 0);
    assert.equal(total, 15200);
    assert.equal(o.members[id].fixedLimit, 15200);
    const amounts = o.members[id].dues.map((d) => d.amount);
    assert.deepEqual(amounts, [3000, 3000, 3000, 3000, 3000, 200]);
  }
  // pay everything from advance
  for (const id of ids) {
    const pr = await paySingle({ programId: program.id, payerId: id, closingIds: o.members[id].dues.map((d) => d.closingMemberId), useAdvance: true }, auth());
    assert.deepEqual([pr.totalPaid, pr.fromAdvance], [15200, 15200]);
    assert.equal(await advanceBalance(id), 0);
  }
  const L = await add("L1"); await close(L);
  const o2 = await openDuesFor(program.id, ids);
  for (const id of ids) {
    assert.equal(o2.members[id].dues.length, 0, "nothing more to pay");
    const st = await limitStatus(id);
    assert.deepEqual([st.paid, st.left, st.reached], [15200, 0, true]);
  }
  // remove the limit for all → they owe the new closings again
  await setFixedLimit(program.id, { memberIds: ids, fixedLimit: null }, auth());
  const o3 = await openDuesFor(program.id, [ids[0]]);
  assert.ok(o3.members[ids[0]].dues.length >= 1);
});

test("a new member with a limit, added after closings, gets only up to it", async () => {
  const N = await add("N", { fixedLimit: 250 });
  const b = await book(N);
  const total = (await limitStatus(N)).owed;
  assert.equal(total, 250);
  assert.ok(b.length >= 2 && b.at(-1).includes(":50/0:"));
});

test("closing date moved earlier → limited member's share follows the new order", async () => {
  const U = await add("U", { fixedLimit: 300, dateJoin: "2026-08-01" });
  const X = await add("X1", { dateJoin: "2026-08-01" }); const Y = await add("Y1", { dateJoin: "2026-08-01" });
  await recordClosing(X, { closingDate: "2026-08-10" });
  await recordClosing(Y, { closingDate: "2026-08-20" });
  assert.deepEqual(await book(U), ["X1:200/0:pending", "Y1:100/0:pending"]);
  await updateClosing(Y, { closingDate: "2026-08-05" });
  assert.deepEqual(await book(U), ["Y1:200/0:pending", "X1:100/0:pending"]);
});

test("book invariant: limited members never owe + paid more than their limit", async () => {
  const { rows } = await db.execute(sql`
    SELECT m.id, m.fixed_limit, COALESCE(sum(d.amount), 0)::int AS total, COALESCE(sum(d.paid_amount), 0)::int AS paid,
      bool_or(d.paid_amount > d.amount) AS over, bool_or(d.amount <= 0) AS zero
    FROM members m LEFT JOIN dues d ON d.payer_member_id = m.id
    WHERE m.program_id = ${program.id} AND m.fixed_limit IS NOT NULL GROUP BY m.id`);
  for (const r of rows) {
    assert.ok(r.total <= Math.max(r.fixed_limit, r.paid), `member ${r.id}: total ${r.total} > limit ${r.fixed_limit}`);
    assert.ok(!r.over && !r.zero, `member ${r.id}`);
  }
});
