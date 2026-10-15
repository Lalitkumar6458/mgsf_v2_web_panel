// Runs scripts/migrate-from-firestore.js on a small Firestore-shaped sample and checks the result.
import "./setup.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";

pg.types.setTypeParser(1082, (v) => v);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
after(() => db.end());
const q = async (s, p) => (await db.query(s, p)).rows;

test("firestore sample imports with old bugs cleaned up", async () => {
  await db.query("TRUNCATE admins, accounts, sessions, otps CASCADE");
  execFileSync(process.execPath, ["scripts/migrate-from-firestore.js", "--from-json=tests/fixtures/firestore-sample.json", "--admin-password=Admin@12345"], { env: process.env, stdio: "pipe" });

  const m = Object.fromEntries((await q("SELECT * FROM members")).map((r) => [r.id, r]));
  assert.equal(m.M1.status, "closed");
  assert.equal(m.M1.closing_date, "2026-02-15");
  assert.equal(m.M1.closing_group_id, "G1");
  assert.equal(m.M1.extra.someOldField, "keep me");           // unknown fields kept
  assert.equal(m.M3.blocked, true);                           // status "blocked"
  assert.equal(m.M3.date_join, "2026-03-01");                 // bad dateJoin → createdAt
  assert.equal(m.M3.agent_id, null);                          // unknown agent
  assert.equal(m.M5.status, "accepted");                      // married without date → not closed

  const dues = await q("SELECT id, status, paid_amount FROM dues ORDER BY id");
  assert.deepEqual(dues.map((d) => d.id), ["M1_M2", "M1_M5b"]); // self, orphan, deleted, duplicate skipped
  const tx = await q("SELECT id, status FROM transactions ORDER BY id");
  assert.deepEqual(tx.map((t) => t.status), ["completed", "completed", "reversed"]);

  const jf = await q("SELECT id, amount, payment_date, agent_id FROM join_fee_payments");
  assert.deepEqual(jf.map((x) => [x.id, x.amount, x.agent_id]), [["JF1", 500, "AG1"]]); // orphan skipped

  const logins = (await q("SELECT login_id FROM accounts ORDER BY login_id")).map((r) => r.login_id);
  assert.deepEqual(logins, ["r100001", "r100002", "r100003", "suresh@x.in", "trust@mgsf.in"]);
});
