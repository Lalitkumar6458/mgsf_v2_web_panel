// Feature lock (secret /feature-control page): above roles, applies to the trust's super admin too.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import {
  normalizeFeatures, disabledModules, featureForApi, presetFlags, FEATURE_KEYS, hasFeature, waLink, todayIST,
} from "../src/lib/features.js";
import { can } from "../src/lib/permissions.js";
import { assertApiAccess } from "../src/lib/apiAccess.js";
import { loginBlock, blockedError } from "../src/lib/auth.js";
import { getTrustFeatures, saveTrustFeatures, listTrustFeatures, clearFeatureCache } from "../src/services/features.js";
import { checkKey, controlEnabled, issueControlToken, requireControl, CONTROL_COOKIE } from "../src/lib/controlAuth.js";

let trust;
before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [trust] = await db.insert(schema.admins).values({ email: "f@test.in", displayName: "Feature Trust", extra: { theme: { preset: "x" } } }).returning();
  clearFeatureCache();
});
after(() => pool.end());

const req = (method, path) => new Request(`http://x${path}`, { method });

test("normalize: missing = on, unknown keys dropped, panel active by default", () => {
  const f = normalizeFeatures({ flags: { theme: false, bogus: false } });
  assert.equal(f.flags.theme, false);
  assert.equal(f.flags.members, true);
  assert.equal("bogus" in f.flags, false);
  assert.equal(f.active, true);
  assert.equal(Object.keys(normalizeFeatures(null).flags).length, FEATURE_KEYS.length);
  assert.equal(presetFlags("basic").reports, false);
  assert.equal(presetFlags("full").reports, true);
});

test("switched-off screen is closed for super admin too; roles still apply to staff", () => {
  const features = normalizeFeatures({ flags: { reports: false } });
  const superAdmin = { isSuper: true, off: disabledModules(features), features: features.flags };
  assert.equal(can(superAdmin, "reports"), false);
  assert.equal(can(superAdmin, "members", "delete"), true);
  const staff = { isSuper: false, permissions: { reports: ["view"], members: ["view"] }, off: ["reports"] };
  assert.equal(can(staff, "reports"), false);
  assert.equal(can(staff, "members"), true);
  assert.equal(hasFeature(superAdmin, "theme"), true);
  assert.equal(hasFeature(null, "theme"), true);
});

test("API guard: screens + extra features, owner never limited, unmapped routes stay open", () => {
  const features = normalizeFeatures({ flags: { reports: false, theme: false, certificates: false, paymentPdf: false } });
  const admin = { role: "admin", access: { isSuper: true, off: disabledModules(features), features: features.flags }, features: features.flags };
  assert.throws(() => assertApiAccess(admin, req("GET", "/api/programs/p1/reports/late")), /chalu nahi/);
  assert.throws(() => assertApiAccess(admin, req("PATCH", "/api/trust/theme")), /Theme/);
  assert.doesNotThrow(() => assertApiAccess(admin, req("GET", "/api/trust/theme"))); // reading colours is fine
  assert.throws(() => assertApiAccess(admin, req("POST", "/api/certificate-send")), /certificate/);
  assert.throws(() => assertApiAccess(admin, req("GET", "/api/programs/p1/transactions/report")), /PDF/);
  assert.doesNotThrow(() => assertApiAccess(admin, req("GET", "/api/programs/p1/transactions")));
  assert.doesNotThrow(() => assertApiAccess(admin, req("GET", "/api/some-new-thing")));
  // an agent of the trust meets the extra-feature lock as well
  assert.throws(() => assertApiAccess({ role: "agent", features: features.flags }, req("POST", "/api/certificate-send")));
  assert.doesNotThrow(() => assertApiAccess({ role: "owner", features: features.flags }, req("POST", "/api/certificate-send")));
  assert.equal(featureForApi("GET", "/api/certificate-templates/active"), "certificates");
  assert.equal(featureForApi("PUT", "/api/certificate-templates/t1"), "certificateBuilder");
});

test("login lock: panel closed / agent or member login off; owner untouched", () => {
  const closed = normalizeFeatures({ active: false, message: "Fees baki hai" });
  assert.equal(loginBlock({ role: "admin" }, closed), "Fees baki hai");
  assert.match(loginBlock({ role: "admin" }, normalizeFeatures({ active: false })), /band/);
  assert.equal(loginBlock({ role: "owner" }, closed), null);
  const noAgents = normalizeFeatures({ flags: { agentLogin: false } });
  assert.match(loginBlock({ role: "agent" }, noAgents), /Agent login/);
  assert.equal(loginBlock({ role: "admin" }, noAgents), null);
  assert.equal(loginBlock({ role: "member" }, noAgents), null);
});

test("storage: saved into admins.extra.features without touching the rest of extra; cache cleared on save", async () => {
  assert.equal((await getTrustFeatures(trust.id)).flags.theme, true);
  await saveTrustFeatures(trust.id, { flags: { theme: false }, active: true });
  const f = await getTrustFeatures(trust.id);
  assert.equal(f.flags.theme, false);
  assert.ok(f.updatedAt);
  const { rows: [r] } = await db.execute(sql`SELECT extra FROM admins WHERE id = ${trust.id}`);
  assert.deepEqual(r.extra.theme, { preset: "x" });
  const list = await listTrustFeatures();
  assert.equal(list.find((t) => t.id === trust.id).features.flags.theme, false);
  await assert.rejects(saveTrustFeatures("nope", {}), /nahi mila/);
});

test("control key: off without CONTROL_KEY, wrong key counted, right key → cookie that verifies", async () => {
  const old = process.env.CONTROL_KEY;
  process.env.CONTROL_KEY = "";
  assert.equal(controlEnabled(), false);
  assert.throws(() => checkKey("x", "1.1.1.1"), /Not found/);
  process.env.CONTROL_KEY = "test-control-key-123";
  assert.throws(() => checkKey("wrong", "2.2.2.2"), /Galat/);
  for (let i = 0; i < 5; i++) assert.throws(() => checkKey("wrong", "3.3.3.3"), /Galat/);
  assert.throws(() => checkKey("test-control-key-123", "3.3.3.3"), /minute/); // locked after 5 misses
  assert.doesNotThrow(() => checkKey("test-control-key-123", "4.4.4.4"));
  const { token } = await issueControlToken();
  const ok = new Request("http://x/api/control/trusts", { headers: { cookie: `${CONTROL_COOKIE}=${token}` } });
  await requireControl(ok);
  await assert.rejects(requireControl(new Request("http://x/api/control/trusts")), /login/);
  process.env.CONTROL_KEY = "another-control-key-456"; // new key = old sessions end
  await assert.rejects(requireControl(ok), /khatam/);
  process.env.CONTROL_KEY = old ?? "";
});

test("plan expiry: works through the last day, closed the next day, warning before", async () => {
  const { planState, todayIST } = await import("../src/lib/features.js");
  const day = (n) => new Date(Date.parse(todayIST()) + n * 86400000).toISOString().slice(0, 10);
  assert.deepEqual(planState(normalizeFeatures({})), { expiresAt: null, daysLeft: null, expired: false, warn: false });
  assert.equal(planState(normalizeFeatures({ expiresAt: day(0) })).expired, false);
  assert.equal(planState(normalizeFeatures({ expiresAt: day(0) })).warn, true);
  assert.equal(planState(normalizeFeatures({ expiresAt: day(-1) })).expired, true);
  assert.equal(planState(normalizeFeatures({ expiresAt: day(30) })).warn, false);
  assert.equal(planState(normalizeFeatures({ expiresAt: day(5), warnDays: 3 })).warn, false);
  assert.match(loginBlock({ role: "admin" }, normalizeFeatures({ expiresAt: day(-2) })), /plan khatam/i);
  assert.equal(loginBlock({ role: "owner" }, normalizeFeatures({ expiresAt: day(-2) })), null);
  assert.equal(normalizeFeatures({ expiresAt: "kal" }).expiresAt, null);
});

test("new switches: grouped on the control page, guard their APIs", async () => {
  const { FEATURE_GROUPS, featureForApi: f } = await import("../src/lib/features.js");
  const keys = FEATURE_GROUPS.flatMap((g) => g.items.map((i) => i.key));
  for (const k of ["upiQr", "verifyQr", "rasidDesign", "duplicateCheck", "aadhaarMask", "blankForm", "cashHandover", "auditLog", "whatsapp"]) assert.ok(keys.includes(k), k);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(f("GET", "/api/members/duplicates"), "duplicateCheck");
  assert.equal(f("POST", "/api/certificate-templates/verify-codes"), "verifyQr");
  assert.equal(f("PUT", "/api/trust/receipt-settings"), "rasidDesign");
  assert.equal(f("GET", "/api/trust/receipt-settings"), null);
  const admin = { role: "admin", access: { isSuper: true, off: [] }, features: normalizeFeatures({ flags: { duplicateCheck: false } }).flags };
  assert.throws(() => assertApiAccess(admin, req("GET", "/api/members/duplicates")), /Duplicate/);
});

test("renew contact: cleaned, saved, sent with the expired / closed block", async () => {
  const f = normalizeFeatures({ support: { name: "  Lalit ", phone: "+91 98765-43210", email: "a@b.in", bogus: 1 } });
  assert.deepEqual(f.support, { name: "Lalit", phone: "+919876543210", whatsapp: "", email: "a@b.in", note: "" });
  assert.equal(normalizeFeatures(null).support.phone, "");
  assert.equal(waLink("98765 43210", "hi there"), "https://wa.me/919876543210?text=hi%20there");
  assert.equal(waLink(""), null);

  const old = new Date(Date.parse(todayIST()) - 3 * 86400000).toISOString().slice(0, 10);
  const saved = await saveTrustFeatures(trust.id, { expiresAt: old, support: { name: "Lalit", phone: "9876543210" } });
  assert.equal(saved.support.name, "Lalit");
  const e = await blockedError(403, { adminId: trust.id, role: "admin" }, saved, loginBlock({ role: "admin" }, saved));
  assert.equal(e.status, 403);
  assert.equal(e.details.blocked.reason, "expired");
  assert.equal(e.details.blocked.expiresAt, old);
  assert.equal(e.details.blocked.support.phone, "9876543210");
  assert.equal(e.details.blocked.trustName, "Feature Trust");
  const off = normalizeFeatures({ active: false });
  const e2 = await blockedError(401, { adminId: trust.id }, off, "x");
  assert.deepEqual([e2.details.blocked.reason, e2.details.blocked.support], ["inactive", null]);
  // agent login switched off is not a "panel band" screen
  const e3 = await blockedError(403, { adminId: trust.id, role: "agent" }, normalizeFeatures({ flags: { agentLogin: false } }), "x");
  assert.equal(e3.details, undefined);
  await saveTrustFeatures(trust.id, {});
});
