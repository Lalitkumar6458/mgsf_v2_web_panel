// WhatsApp (Gupshup): settings, template params from variables, 3 automatic messages with PDF links,
// callback status + inbox, reply window.  npm test   (Gupshup is replaced by a fake fetch)
import "./setup.js";
process.env.JWT_SECRET ||= "test-secret-0123456789abcdef0123456789";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { normalizeWhatsapp, publicWhatsapp, mergeWhatsapp, waPhone, slotCount, fill, preview } from "../src/lib/whatsappSettings.js";
import {
  trustForCallback,
  saveWhatsapp, whatsappForPanel, getWhatsapp, onJoin, onPayment, onClosing, bulkSend, handleCallback, inbox, thread, reply,
  messageLog, readFileToken, fileToken, buildParams, testSend,
} from "../src/services/whatsapp.js";
import { saveTrustFeatures, clearFeatureCache } from "../src/services/features.js";

let admin, program, calls = [], nextFail = false, n = 0;
const realFetch = globalThis.fetch;
const BASE = "https://admin.trust.in";

before(async () => {
  globalThis.fetch = async (url, opts) => {
    const form = Object.fromEntries(new URLSearchParams(opts.body.toString()));
    calls.push({ url, apikey: opts.headers.apikey, ...form });
    if (nextFail) return { ok: false, status: 400, text: async () => JSON.stringify({ status: "error", message: "Template Not Found" }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({ status: "submitted", messageId: `gs-${++n}` }) };
  };
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "w@test.in", trustInfo: { name: "W Trust" }, phone: "9000000001" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah", hiname: "विवाह योजना" }).returning();
  const m = (id, extra) => ({ id, programId: program.id, dateJoin: "2026-01-05", status: "accepted", payAmount: 200, displayName: id, ...extra });
  await db.insert(schema.members).values([
    m("p1", { displayName: "Ramesh", phone: "+91 98765 43210", registrationNumber: "R1", village: "Pali" }),
    m("p2", { displayName: "Suresh", phone: "9000000000", registrationNumber: "R2" }),
    m("p3", { displayName: "NoPhone", phone: "" }),
    m("c1", { displayName: "Mohan", closingDate: "2026-02-01", village: "Jodhpur" }),
  ]);
  await db.insert(schema.dues).values([
    { id: "d1", programId: program.id, closingMemberId: "c1", payerMemberId: "p1", amount: 200, dueDate: "2026-03-01" },
    { id: "d2", programId: program.id, closingMemberId: "c1", payerMemberId: "p2", amount: 200, paidAmount: 200, status: "paid", dueDate: "2026-03-01" },
  ]);
  clearFeatureCache();
});
beforeEach(() => { calls = []; nextFail = false; });
after(() => { globalThis.fetch = realFetch; return pool.end(); });

test("helpers: phone, slots, variables, preview", () => {
  assert.equal(waPhone("+91 98765-43210"), "919876543210");
  assert.equal(waPhone("09876543210"), "919876543210");
  assert.equal(waPhone("123"), "");
  assert.equal(slotCount("Namaste {{1}}, ₹{{3}} … {{2}}"), 3);
  assert.equal(fill("{name} ji ₹{pendingAmount} {bogus}", { name: "R", pendingAmount: "600" }), "R ji ₹600 {bogus}");
  assert.equal(preview("Hi {{1}}, {{2}}", ["A", "B"]), "Hi A, B");
  const ev = { body: "{{1}} {{2}} {{3}}", params: ["{name}", "", "₹{payAmount}"] };
  assert.deepEqual(buildParams(ev, { name: "R", payAmount: "200" }), ["R", "-", "₹200"]); // empty slot → "-"
});

test("settings: key never sent back, empty key keeps the saved one, template needed when on", async () => {
  await assert.rejects(saveWhatsapp(admin.id, { enabled: true, events: { join: { on: true } } }), /Template ID/);
  const s = await saveWhatsapp(admin.id, {
    enabled: true, apiKey: "secret-key-1234", source: "+91 90000 11111", appName: "WTrust",
    events: {
      join: { on: true, templateId: "tpl-join", body: "नमस्ते {{1}}, रजि. {{2}}", params: ["{name}", "{regNo}"] },
      pending: { on: true, templateId: "tpl-due", body: "{{1}} बकाया ₹{{2}} ({{3}})", params: ["{name}", "{pendingAmount}", "{closingNames}"] },
      paid: { on: true, templateId: "tpl-paid", body: "{{1}} ₹{{2}} जमा", params: ["{name}", "{paidAmount}"] },
    },
  });
  assert.equal(s.apiKey, "");
  assert.equal(s.apiKeyHint, "••••1234");
  assert.equal(s.source, "919000011111");
  await saveWhatsapp(admin.id, { apiKey: "", appName: "WTrust" });
  assert.equal((await getWhatsapp(admin.id)).apiKey, "secret-key-1234");
  const p = await whatsappForPanel(admin.id, BASE);
  assert.match(p.callbackUrlWithKey, new RegExp(`^${BASE}/api/whatsapp/callback/${admin.id}/[a-f0-9]{32}$`));
  assert.equal(publicWhatsapp(normalizeWhatsapp({ apiKey: "x" })).apiKey, "");
  assert.equal(mergeWhatsapp({ apiKey: "a" }, { apiKey: "b" }).apiKey, "b");
});

test("join: template + certificate PDF link, only once per member, number without phone skipped", async () => {
  const r = await onJoin(admin.id, "p1", BASE);
  assert.deepEqual([r.sent, r.failed], [1, 0]);
  const c = calls[0];
  assert.equal(c.url, "https://api.gupshup.io/wa/api/v1/template/msg");
  assert.equal(c.apikey, "secret-key-1234");
  assert.deepEqual([c.source, c.destination, c["src.name"]], ["919000011111", "919876543210", "WTrust"]);
  assert.deepEqual(JSON.parse(c.template), { id: "tpl-join", params: ["Ramesh", "R1"] });
  const msg = JSON.parse(c.message);
  assert.equal(msg.type, "document");
  assert.match(msg.document.link, new RegExp(`^${BASE}/api/wa/file/[^/]+/certificate-R1\\.pdf$`));
  const tok = readFileToken(msg.document.link.split("/").at(-2));
  assert.deepEqual([tok.adminId, tok.kind, tok.memberId], [admin.id, "certificate", "p1"]);
  assert.equal(readFileToken(`${msg.document.link.split("/").at(-2)}x`), null); // tampered
  assert.equal((await onJoin(admin.id, "p1", BASE)).reason, "already");
  assert.equal((await onJoin(admin.id, "p3", BASE)).skipped, 1);
  assert.equal(calls.length, 1);
});

test("pending (new closing) + paid (payment) with their rasid", async () => {
  await onClosing(admin.id, "c1", BASE);       // only p1 owes for c1
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].template).params, ["Ramesh", "200", "Mohan (Jodhpur)"]);
  assert.match(JSON.parse(calls[0].message).document.link, /baki-rasid-R1\.pdf$/);

  await db.insert(schema.transactions).values({ id: "t1", programId: program.id, transactionNumber: "TX1", batchId: "B1", payerMemberId: "p2", closingMemberId: "c1", dueId: "d2", amount: 200, paymentDate: "2026-02-10" });
  calls = [];
  await onPayment(admin.id, "B1", BASE);
  assert.deepEqual(JSON.parse(calls[0].template).params, ["Suresh", "200"]);
  const tok = readFileToken(JSON.parse(calls[0].message).document.link.split("/").at(-2));
  assert.deepEqual([tok.kind, tok.batchId], ["paidReceipt", "B1"]);
});

test("bulk reminder: only members who owe; feature switched off → nothing", async () => {
  const r = await bulkSend(admin.id, { event: "pending" }, BASE);
  assert.equal(r.queued, 1);
  assert.equal(calls.at(-1).destination, "919876543210");
  await saveTrustFeatures(admin.id, { flags: { whatsappApi: false } });
  calls = [];
  assert.equal(await onJoin(admin.id, "p2", BASE), null);
  await assert.rejects(bulkSend(admin.id, { event: "pending" }, BASE), /chalu nahi/);
  assert.equal(calls.length, 0);
  await saveTrustFeatures(admin.id, {});
});

test("Gupshup error is saved as failed; test send throws it", async () => {
  nextFail = true;
  await assert.rejects(testSend(admin.id, { event: "join", phone: "9811111111" }, BASE), /Template Not Found/);
  const log = await messageLog(admin.id, { status: "failed" });
  assert.equal(log.messages[0].error, "Gupshup: Template Not Found");
});

test("callback: wrong secret ignored; status moves forward only; member reply → inbox; 24 h reply", async () => {
  const s = await getWhatsapp(admin.id);
  const ev = (type, id, gsId, payload = {}) => ({ app: "WTrust", version: 2, type: "message-event", payload: { id, gsId, type, destination: "919876543210", payload } });
  assert.equal((await handleCallback(admin.id, "bad", ev("read", "x"))).ok, false);
  await handleCallback(admin.id, s.secret, ev("enqueued", "gs-1", undefined, { whatsappMessageId: "wamid-1" }));
  await handleCallback(admin.id, s.secret, ev("read", "wamid-1", "gs-1"));
  await handleCallback(admin.id, s.secret, ev("delivered", "wamid-1", "gs-1"));   // late → stays read
  const [{ status }] = (await db.execute(sql`SELECT status FROM whatsapp_messages WHERE provider_id = 'gs-1'`)).rows;
  assert.equal(status, "read");
  await handleCallback(admin.id, s.secret, ev("failed", "gs-2", undefined, { code: 1008, reason: "User is not Opted in" }));
  const [{ error }] = (await db.execute(sql`SELECT error FROM whatsapp_messages WHERE provider_id = 'gs-2'`)).rows;
  assert.equal(error, "1008: User is not Opted in");

  // reply before the member wrote → WhatsApp rule
  await assert.rejects(reply(admin.id, "9876543210", "hello"), /24 ghante/);
  const inMsg = { app: "WTrust", version: 2, type: "message", payload: { id: "in-1", source: "919876543210", type: "text", payload: { text: "रसीद मिल गई धन्यवाद" }, sender: { phone: "919876543210", name: "Ramesh WA" } } };
  assert.equal((await handleCallback(admin.id, s.secret, inMsg)).saved, true);
  assert.equal((await handleCallback(admin.id, s.secret, inMsg)).duplicate, true);
  const box = await inbox(admin.id);
  const chat = box.chats.find((c) => c.phone === "919876543210");
  assert.deepEqual([box.unread, chat.unread, chat.name, chat.regNo, chat.canReply], [1, 1, "Ramesh", "R1", true]);
  assert.equal((await inbox(admin.id, { q: "ramesh" })).chats.length, 1);
  const t = await thread(admin.id, "9876543210");
  assert.equal(t.messages.at(-1).body, "रसीद मिल गई धन्यवाद");
  assert.equal((await inbox(admin.id)).unread, 0);                   // opened → read
  calls = [];
  await reply(admin.id, "9876543210", "धन्यवाद जी 🙏");
  assert.equal(calls[0].url, "https://api.gupshup.io/wa/api/v1/msg");
  assert.deepEqual(JSON.parse(calls[0].message), { type: "text", text: "धन्यवाद जी 🙏" });
});

test("file token expires", () => {
  const t = fileToken({ adminId: "a", kind: "certificate", memberId: "m" }, -1);
  assert.equal(readFileToken(t), null);
});

test("callback key from header; new key stops the old one", async () => {
  const { keyFromHeaders, WEBHOOK_HEADER } = await import("../src/services/whatsapp.js");
  assert.equal(keyFromHeaders(new Headers({ [WEBHOOK_HEADER]: "abc" })), "abc");
  assert.equal(keyFromHeaders(new Headers({ "x-api-key": "k1" })), "k1");
  assert.equal(keyFromHeaders(new Headers({ authorization: "Bearer k2" })), "k2");
  assert.equal(keyFromHeaders(new Headers({})), "");
  const p = await whatsappForPanel(admin.id, BASE);
  assert.equal(p.callbackUrl, `${BASE}/api/whatsapp/callback`);
  assert.deepEqual(p.callbackHeader, { name: "x-webhook-key", value: (await getWhatsapp(admin.id)).secret });
  const old = p.callbackHeader.value;
  await saveWhatsapp(admin.id, { rotateSecret: true });
  const ev = { type: "message-event", payload: { id: "zz", type: "read" } };
  assert.equal((await handleCallback(admin.id, old, ev)).ok, false);
  assert.equal((await handleCallback(admin.id, (await getWhatsapp(admin.id)).secret, ev)).ok, true);
});

test("plain URL: no key accepted, wrong key rejected", async () => {
  const ev = { type: "message-event", payload: { id: "nokey", type: "read" } };
  assert.equal((await handleCallback(admin.id, "", ev, { keyOptional: true })).ok, true);
  assert.equal((await handleCallback(admin.id, "wrong", ev, { keyOptional: true })).ok, false);
  assert.equal((await handleCallback(admin.id, "", ev)).ok, false);   // key-in-URL route still needs it
});

test("one URL for all trusts: trust from key header or Gupshup app name", async () => {
  const s = await getWhatsapp(admin.id);
  assert.equal((await trustForCallback({ app: "x" }, s.secret)).adminId, admin.id);
  assert.equal(await trustForCallback({ app: "WTrust" }, "wrong-key"), null);
  assert.equal((await trustForCallback({ app: "wtrust" }, "")).adminId, admin.id);   // app name, any case
  const [other] = await db.insert(schema.admins).values({ email: "o2@test.in", extra: { whatsapp: { appName: "OtherApp", apiKey: "k" } } }).returning();
  assert.equal((await trustForCallback({ app: "OtherApp" }, "")).adminId, other.id);
  assert.equal(await trustForCallback({ app: "Unknown" }, ""), null);               // 2 trusts set up → no guess
});
