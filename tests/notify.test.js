// Expo push notifications: family reach, merged pushes, dead tokens, panel send, automatic ones.  npm test
// Expo's push service is replaced by a fake fetch that records every message.
import "./setup.js";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { notify, notifyMembers, isExpoToken } from "../src/lib/push.js";
import { sendNotification, audience, sentList } from "../src/services/notifySend.js";
import { notifyClosing, notifyPayment } from "../src/services/autoNotify.js";
import { saveAppSettings } from "../src/services/mobileApp.js";

let admin, program, sent = [];
const realFetch = globalThis.fetch;
const TOK = { p1: "ExponentPushToken[aaa]", p3: "ExpoPushToken[bbb]", ag: "ExponentPushToken[ccc]" };

before(async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, "https://exp.host/--/api/v2/push/send");
    const msgs = JSON.parse(opts.body);
    sent.push(...msgs);
    const data = msgs.map((m) => (m.to === TOK.p3 ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "x" }));
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "n@test.in", trustInfo: { name: "N Trust" } }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah" }).returning();
  await db.insert(schema.agents).values({ id: "AG", adminId: admin.id, displayName: "Ramesh" });
  const m = (id, extra) => ({ id, programId: program.id, dateJoin: "2026-01-01", status: "accepted", payAmount: 200, displayName: id, agentId: "AG", ...extra });
  await db.insert(schema.members).values([
    m("p1", { phone: "+91 98765 43210", registrationNumber: "R1" }),
    m("p2", { phone: "9876543210", registrationNumber: "R2" }),          // same mobile = family of p1
    m("p3", { phone: "9000000000", registrationNumber: "R3" }),
    m("c1", { closingDate: "2026-02-01", village: "Pali", agentId: null }),
  ]);
  await db.insert(schema.accounts).values([
    { id: "a1", role: "member", loginId: "r1", passwordHash: "x", adminId: admin.id, memberId: "p1", pushToken: TOK.p1 },
    { id: "a2", role: "member", loginId: "r2", passwordHash: "x", adminId: admin.id, memberId: "p2" },
    { id: "a3", role: "member", loginId: "r3", passwordHash: "x", adminId: admin.id, memberId: "p3", pushToken: TOK.p3 },
    { id: "ag", role: "agent", loginId: "ag@x", passwordHash: "x", adminId: admin.id, agentId: "AG", pushToken: TOK.ag },
  ]);
  await db.insert(schema.dues).values([
    { id: "d1", programId: program.id, closingMemberId: "c1", payerMemberId: "p1", amount: 200, dueDate: "2026-03-01" },
    { id: "d2", programId: program.id, closingMemberId: "c1", payerMemberId: "p2", amount: 200, dueDate: "2026-03-01" },
    { id: "d3", programId: program.id, closingMemberId: "c1", payerMemberId: "p3", amount: 200, paidAmount: 200, status: "paid", dueDate: "2026-03-01" },
  ]);
});
beforeEach(() => { sent = []; });
after(() => { globalThis.fetch = realFetch; return pool.end(); });

test("tokens: old + new Expo formats only", () => {
  assert.ok(isExpoToken("ExponentPushToken[x]") && isExpoToken("ExpoPushToken[x]"));
  assert.ok(!isExpoToken("fcm-raw-token") && !isExpoToken(""));
});

test("member message reaches the same-mobile family phone; one push per phone", async () => {
  const r = await notifyMembers(admin.id, [
    { memberId: "p2", title: "A", body: "for p2" },
    { memberId: "p1", title: "A", body: "for p1" },
  ]);
  // p2 has no phone token → his message goes to p1's phone (family); both merged into one push
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, TOK.p1);
  assert.equal(sent[0].title, "A (2)");
  assert.match(sent[0].body, /for p2[\s\S]*for p1|for p1[\s\S]*for p2/);
  assert.equal(sent[0].channelId, "marriage-custom-channel");
  assert.equal(r.devices, 1);
  // inbox: p1 + p2 logins each get both rows (family) → 4
  assert.equal(r.saved, 4);
});

test("uninstalled phone loses its token", async () => {
  const r = await notify(admin.id, ["a3"], { title: "x" });
  assert.deepEqual([r.pushed, r.failed], [0, 1]);
  const [{ push_token }] = (await db.execute(sql`SELECT push_token FROM accounts WHERE id = 'a3'`)).rows;
  assert.equal(push_token, null);
});

test("panel send: audience, dues amount added, history", async () => {
  const a = await audience(admin.id, { to: "dues" });
  assert.deepEqual([a.members, a.agents], [2, 0]);               // p1, p2 owe (c1 has no dues, p3 paid)
  const r = await sendNotification(admin.id, { title: "याद", body: "कृपया जमा करें", to: "dues" });
  assert.equal(r.devices, 1);
  assert.match(sent[0].body, /आपका बकाया: ₹200/);
  const all = await audience(admin.id, { to: "all" });
  assert.equal(all.agents, 1);
  await sendNotification(admin.id, { title: "बैठक", to: "agents" });
  assert.equal(sent.at(-1).to, TOK.ag);
  const h = await sentList(admin.id);
  assert.deepEqual(h.map((x) => x.to), ["agents", "dues"]);
  await assert.rejects(sendNotification(admin.id, { title: "" }), /Title/);
});

test("automatic: new closing → members with their amount + agent total; payment → payer", async () => {
  const r = await notifyClosing(admin.id, "c1");
  const toAgent = sent.find((m) => m.to === TOK.ag);
  assert.match(toAgent.body, /2 सदस्यों से ₹400/);
  const toFamily = sent.find((m) => m.to === TOK.p1);
  assert.match(toFamily.title, /नई क्लोजिंग: c1 \(Pali\)/);
  assert.match(toFamily.body, /₹200 · अंतिम तिथि 01-03-2026/);
  assert.ok(r.members.saved >= 2);

  await db.insert(schema.transactions).values({ id: "t1", programId: program.id, transactionNumber: "TX1", batchId: "B9", payerMemberId: "p1", closingMemberId: "c1", dueId: "d1", amount: 200, paymentDate: "2026-02-10" });
  sent = [];
  await notifyPayment(admin.id, "B9");
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /p1 \(रजि. R1\): ₹200 — 1 क्लोजिंग/);

  // switched off in Settings → no push
  await saveAppSettings(admin.id, { notify: { payment: false, closing: false, agentClosing: false } });
  sent = [];
  assert.equal(await notifyPayment(admin.id, "B9"), null);
  assert.equal(await notifyClosing(admin.id, "c1"), null);
  assert.equal(sent.length, 0);
});
