// App payment requests: member / agent sends UTR → office approves (payment written) or rejects.   npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { createMember } from "../src/services/members.js";
import { recordClosing } from "../src/services/closings.js";
import { createRequest, myRequests, cancelRequest, listRequests, requestDetail, approveRequest, rejectRequest } from "../src/services/paymentRequests.js";
import { memberDetail } from "../src/services/mobileApp.js";
import { advanceBalance } from "../src/services/advances.js";

let admin, program, A, B, X, C1, C2, C3;
const office = () => ({ role: "admin", adminId: admin.id, accountId: "office", displayName: "Office" });
const memberAuth = () => ({ role: "member", adminId: admin.id, memberId: A, accountId: "accA", displayName: "A" });
const agentAuth = () => ({ role: "agent", adminId: admin.id, agentId: "AG", accountId: "accAG", displayName: "Ramesh" });
const dueIds = async (payer) => (await db.execute(sql`
  SELECT d.id FROM dues d JOIN members c ON c.id = d.closing_member_id WHERE d.payer_member_id = ${payer} AND d.status <> 'paid' ORDER BY c.closing_date`)).rows.map((r) => r.id);
const dues = async (payer) => (await db.execute(sql`
  SELECT c.display_name AS c, d.paid_amount, d.status::text AS s FROM dues d JOIN members c ON c.id = d.closing_member_id
  WHERE d.payer_member_id = ${payer} ORDER BY c.closing_date`)).rows.map((r) => `${r.c}:${r.paid_amount}:${r.s}`);

before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "pr@test.in", displayName: "PR" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah", regMode: "series", regPrefix: "P" }).returning();
  await db.insert(schema.agents).values({ id: "AG", adminId: admin.id, displayName: "Ramesh" });
  const add = async (name, extra = {}) => (await createMember(program, { displayName: name, dateJoin: "2026-01-01", payAmount: 200, ...extra }, office())).member.id;
  A = await add("A", { phone: "9876500001", agentId: "AG", joinFees: 500 });
  B = await add("B", { phone: "9876500001" }); // same mobile → A's family
  X = await add("X", { phone: "9000000000" }); // not his, not the agent's
  C1 = await add("C1"); C2 = await add("C2"); C3 = await add("C3");
  await recordClosing(C1, { closingDate: "2026-03-01" });
  await recordClosing(C2, { closingDate: "2026-04-01" });
  await recordClosing(C3, { closingDate: "2026-05-01" });
});
after(() => pool.end());

test("member sends a request for himself + family; checks UTR, dates, owner", async () => {
  await assert.rejects(createRequest(memberAuth(), { items: [{ memberId: A, dueIds: await dueIds(A) }], amount: 600, reference: "12" }), /UTR/);
  await assert.rejects(createRequest(memberAuth(), { items: [{ memberId: X, dueIds: await dueIds(X) }], amount: 600, reference: "UTR111111" }), /Access denied|forbidden/i);
  await assert.rejects(createRequest(memberAuth(), { items: [{ memberId: A, dueIds: await dueIds(A) }], amount: 600, reference: "UTR111111", paymentDate: "2099-01-01" }), /आगे की तारीख/);
  const r = await createRequest(memberAuth(), {
    items: [{ memberId: A, dueIds: (await dueIds(A)).slice(0, 2) }, { memberId: B, dueIds: (await dueIds(B)).slice(0, 1) }],
    amount: 600, reference: "utr 111 111", screenshotUrl: "/files/x.jpg",
  });
  assert.equal(r.request.status, "pending");
  assert.equal(r.request.reference, "UTR111111");
  assert.equal(r.request.expectedAmount, 600);
  assert.equal(r.warning, "");
  // the app shows those dues as "जाँच में"
  const d = await memberDetail(A);
  assert.deepEqual(d.timeline.map((t) => t.requested), [true, true, false]);
  // same UTR again, or the same closings again → refused
  await assert.rejects(createRequest(memberAuth(), { items: [{ memberId: A, dueIds: [(await dueIds(A))[2]] }], amount: 200, reference: "UTR111111" }), /पहले से/);
  await assert.rejects(createRequest(memberAuth(), { items: [{ memberId: A, dueIds: [(await dueIds(A))[0]] }], amount: 200, reference: "UTR222222" }), /जाँच में/);
  assert.equal((await myRequests(memberAuth())).requests.length, 1);
});

test("office approves → dues paid with the UTR, request approved, nothing left pending", async () => {
  const { requests, counts } = await listRequests(admin.id, { status: "pending" });
  assert.equal(counts.pending, 1);
  const det = await requestDetail(admin.id, requests[0].id);
  assert.equal(det.members.length, 2);
  assert.equal(det.duplicate, null);
  const r = await approveRequest(admin.id, requests[0].id, {}, office());
  assert.equal(r.closingAmount, 600);
  assert.deepEqual(await dues(A), ["C1:200:paid", "C2:200:paid", "C3:0:pending"]);
  assert.deepEqual((await dues(B))[0], "C1:200:paid");
  const { rows } = await db.execute(sql`SELECT DISTINCT online_reference, payment_method FROM transactions WHERE batch_id = ${r.batches[0].batchId}`);
  assert.deepEqual(rows, [{ online_reference: "UTR111111", payment_method: "upi" }]);
  await assert.rejects(approveRequest(admin.id, requests[0].id, {}, office()), /पहले से/);
  assert.equal((await memberDetail(A)).timeline.some((t) => t.requested), false);
});

test("less money than chosen → paid oldest first (part); more → refused unless it goes to advance", async () => {
  const ids = await dueIds(B); // C2, C3
  const r1 = await createRequest(memberAuth(), { items: [{ memberId: B, dueIds: ids }], amount: 300, reference: "UTR333333" });
  assert.match(r1.warning, /₹400/);
  await approveRequest(admin.id, r1.request.id, {}, office());
  assert.deepEqual(await dues(B), ["C1:200:paid", "C2:200:paid", "C3:100:partial"]);

  const r2 = await createRequest(memberAuth(), { items: [{ memberId: B, dueIds: await dueIds(B) }], amount: 250, reference: "UTR444444" });
  await assert.rejects(approveRequest(admin.id, r2.request.id, {}, office()), /₹150 ज़्यादा/);
  const ok = await approveRequest(admin.id, r2.request.id, { extraToAdvance: true }, office());
  assert.deepEqual([ok.closingAmount, ok.advance.amount], [100, 150]);
  assert.equal(await advanceBalance(B), 150);
});

test("joining fee in a request; office can change the amount it really got", async () => {
  const r = await createRequest(memberAuth(), { items: [{ memberId: A, dueIds: await dueIds(A), joinFee: 500 }], amount: 700, reference: "UTR555555" });
  assert.equal(r.request.expectedAmount, 700);
  const ok = await approveRequest(admin.id, r.request.id, { amount: 450 }, office()); // only ₹450 came in the bank
  assert.deepEqual([ok.closingAmount, ok.joinFeeAmount], [200, 250]);
  const { rows: [m] } = await db.execute(sql`SELECT join_fees_paid_amount FROM members WHERE id = ${A}`);
  assert.equal(m.join_fees_paid_amount, 250);
});

test("reject with a reason; cancel by the sender; agent only for his own members", async () => {
  const C4 = (await createMember(program, { displayName: "C4", dateJoin: "2026-01-01" }, office())).member.id;
  await recordClosing(C4, { closingDate: "2026-06-01" });
  const r = await createRequest(memberAuth(), { items: [{ memberId: A, dueIds: await dueIds(A) }], amount: 200, reference: "UTR666666" });
  await assert.rejects(rejectRequest(admin.id, r.request.id, { reason: "" }, office()), /कारण/);
  await rejectRequest(admin.id, r.request.id, { reason: "बैंक में पैसा नहीं आया" }, office());
  const mine = (await myRequests(memberAuth())).requests.find((x) => x.id === r.request.id);
  assert.deepEqual([mine.status, mine.rejectReason], ["rejected", "बैंक में पैसा नहीं आया"]);
  // rejected UTR may be sent again (it was a mistake)
  const again = await createRequest(memberAuth(), { items: [{ memberId: A, dueIds: await dueIds(A) }], amount: 200, reference: "UTR666666" });
  await cancelRequest(memberAuth(), again.request.id);
  await assert.rejects(cancelRequest(memberAuth(), again.request.id), /रद्द नहीं/);

  await assert.rejects(createRequest(agentAuth(), { items: [{ memberId: B, dueIds: await dueIds(B) }], amount: 100, reference: "UTR777777" }), /आपका नहीं/);
  const ag = await createRequest(agentAuth(), { items: [{ memberId: A, dueIds: await dueIds(A) }], amount: 200, reference: "UTR777777" });
  assert.equal(ag.request.agentId, "AG");
  const ok = await approveRequest(admin.id, ag.request.id, {}, office());
  assert.equal(ok.requestedByRole, "agent");
  assert.ok((await dues(A)).every((x) => x.endsWith(":paid")));
});

test("UTR already used by a payment of the office → request refused; everything paid → approve refused", async () => {
  const C5 = (await createMember(program, { displayName: "C5", dateJoin: "2026-01-01" }, office())).member.id;
  await recordClosing(C5, { closingDate: "2026-07-01" });
  await assert.rejects(createRequest(memberAuth(), { items: [{ memberId: A, dueIds: await dueIds(A) }], amount: 200, reference: "UTR111111" }), /पहले से/);
  const r = await createRequest(memberAuth(), { items: [{ memberId: A, dueIds: await dueIds(A) }], amount: 200, reference: "UTR888888" });
  // office took the same closing in cash meanwhile
  const { paySingle } = await import("../src/services/payments.js");
  await paySingle({ programId: program.id, payerId: A, closingIds: [C5] }, office());
  await assert.rejects(approveRequest(admin.id, r.request.id, {}, office()), /कुछ बाकी नहीं/);
});

test("agent: only the joining fee (no closing) — request and approve", async () => {
  const F = (await createMember(program, { displayName: "F", dateJoin: "2026-09-01", agentId: "AG", joinFees: 400 }, office())).member.id;
  await assert.rejects(createRequest(agentAuth(), { items: [{ memberId: F, dueIds: [], joinFee: 0 }], amount: 400, reference: "UTR999001" }), /चुनें/);
  const r = await createRequest(agentAuth(), { items: [{ memberId: F, dueIds: [], joinFee: 400 }], amount: 400, reference: "UTR999001" });
  assert.equal(r.request.expectedAmount, 400);
  const ok = await approveRequest(admin.id, r.request.id, {}, office());
  assert.deepEqual([ok.closingAmount, ok.joinFeeAmount], [0, 400]);
  const { rows: [m] } = await db.execute(sql`SELECT join_fees_paid_amount, join_fees_done FROM members WHERE id = ${F}`);
  assert.deepEqual([m.join_fees_paid_amount, m.join_fees_done], [400, true]);
});
