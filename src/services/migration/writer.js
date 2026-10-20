// Write a bundle into Postgres — ONE transaction, all or nothing.
//   mode "new"     → the trust must not exist yet
//   mode "replace" → that trust (same id) and everything under it is deleted first, then written again
// Logins: passwords are hashed here. A login id already used by ANOTHER trust is skipped (reported).
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../db/index.js";

const COLS_CACHE = new Map();
async function tableColumns(client, table) {
  if (COLS_CACHE.has(table)) return COLS_CACHE.get(table);
  const { rows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1", [table]);
  const set = new Set(rows.map((r) => r.column_name));
  COLS_CACHE.set(table, set);
  return set;
}

/** Insert rows; columns = union of row keys known to the table (keys starting with _ are ours). Missing → DEFAULT. */
export async function insertRows(client, table, rows, { chunk = 300, onChunk } = {}) {
  if (!rows.length) return 0;
  const known = await tableColumns(client, table);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => !c.startsWith("_") && known.has(c));
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const values = [];
    const tuples = part.map((r) => `(${cols.map((c) => {
      if (r[c] === undefined) return "DEFAULT";
      values.push(r[c]);
      return `$${values.length}`;
    }).join(",")})`);
    await client.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")}`, values);
    onChunk?.(Math.min(i + chunk, rows.length), rows.length);
  }
  return rows.length;
}

/** Does this trust (admin id) exist? also by e-mail */
export async function trustExists(adminId, email) {
  const { rows } = await pool.query("SELECT id, email, display_name FROM admins WHERE id = $1 OR lower(email) = lower($2)", [adminId, email || ""]);
  return rows;
}

/**
 * bundle → database. progress(step, done, total, note). Returns { logins, skippedLogins, written }.
 * `isCancelled()` is checked between steps (before the commit).
 */
export async function writeBundle(bundle, { mode = "new", progress = () => {}, isCancelled = () => false } = {}) {
  const adminId = bundle.admin.id;
  // 1. passwords (slow part) — before the transaction so it stays short
  const accounts = [];
  const logins = [];
  const total = bundle.accounts.length;
  for (let i = 0; i < total; i++) {
    const a = bundle.accounts[i];
    accounts.push({ ...a, id: randomUUID(), password_hash: await bcrypt.hash(String(a.password), a.role === "admin" ? 10 : 8) });
    if (a.generated) logins.push({ role: a.role, loginId: a.login_id, password: a.password, name: a.display_name });
    if (i % 50 === 0 || i === total - 1) progress("write", i + 1, total + 9, `login password ${i + 1}/${total}`);
    if (i % 200 === 0 && isCancelled()) throw new Error("Rok diya gaya");
  }

  const client = await pool.connect();
  const skippedLogins = [];
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '20s'");
    const existing = (await client.query("SELECT id, lower(email) AS email FROM admins WHERE id = $1 OR lower(email) = lower($2)", [adminId, bundle.admin.email])).rows;
    if (existing.some((x) => x.id !== adminId)) throw new Error(`E-mail ${bundle.admin.email} kisi doosre trust ka hai — doosra admin e-mail dein`);
    if (existing.length && mode !== "replace") throw new Error("Ye trust pehle se panel mein hai — \"Pehle wala hata kar dobara\" chunein");
    if (existing.length) {
      progress("write", total + 1, total + 9, "purana data hata rahe hain…");
      await client.query("DELETE FROM accounts WHERE admin_id = $1", [adminId]);
      await client.query("DELETE FROM admins WHERE id = $1", [adminId]);
    }
    // ids are kept from Firebase: the same data imported before under ANOTHER trust id would collide
    for (const [table, list, own] of [["programs", bundle.programs, "admin_id"], ["agents", bundle.agents, "admin_id"]]) {
      if (!list.length) continue;
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE id = ANY($1) AND ${own} <> $2`, [list.map((x) => x.id), adminId]);
      if (rows[0].n) throw new Error(`${rows[0].n} ${table} pehle se kisi doosre trust mein hain (wahi Firebase data dobara?) — us trust ko pehle hatayein`);
    }
    {
      const { rows } = await client.query("SELECT count(*)::int AS n FROM members WHERE id = ANY($1)", [bundle.members.map((m) => m.id)]);
      if (rows[0].n) throw new Error(`${rows[0].n} members pehle se kisi doosre trust mein hain (wahi Firebase data dobara?) — us trust ko pehle hatayein`);
    }
    // logins used by other trusts
    const ids = accounts.map((a) => a.login_id);
    const taken = new Set();
    for (let i = 0; i < ids.length; i += 5000) {
      const { rows } = await client.query("SELECT login_id FROM accounts WHERE login_id = ANY($1)", [ids.slice(i, i + 5000)]);
      rows.forEach((r) => taken.add(r.login_id));
    }
    const seen = new Set();
    const finalAccounts = [];
    for (const a of accounts) {
      if (taken.has(a.login_id) || seen.has(a.login_id)) {
        if (a.role === "admin") throw new Error(`Admin login ${a.login_id} pehle se kisi aur ka hai`);
        skippedLogins.push({ role: a.role, loginId: a.login_id, name: a.display_name, reason: taken.has(a.login_id) ? "doosre trust mein yahi login hai" : "ek hi login do baar" });
        continue;
      }
      seen.add(a.login_id);
      finalAccounts.push(a);
    }

    // transaction numbers are unique across ALL trusts — a receipt "RSD-1" of another trust gets a suffix here
    const nums = bundle.transactions.map((t) => t.transaction_number);
    const usedNums = new Set();
    for (let i = 0; i < nums.length; i += 5000) {
      const { rows } = await client.query("SELECT transaction_number FROM transactions WHERE transaction_number = ANY($1)", [nums.slice(i, i + 5000)]);
      rows.forEach((r) => usedNums.add(r.transaction_number));
    }
    if (usedNums.size) {
      const tag = String(adminId).replace(/[^\w]/g, "").slice(0, 6).toUpperCase() || "MIG";
      for (const t of bundle.transactions) if (usedNums.has(t.transaction_number)) t.transaction_number = `${t.transaction_number}-${tag}`;
    }

    // agent login ids (cash hisaab / who collected)
    const agentAcc = new Map(finalAccounts.filter((a) => a.role === "agent").map((a) => [a.agent_id, a.id]));
    for (const t of bundle.transactions) if (t._agentId && agentAcc.has(t._agentId)) t.created_by_id = agentAcc.get(t._agentId);
    for (const j of bundle.joinFees) if (!j.created_by_id && j.agent_id && agentAcc.has(j.agent_id)) j.created_by_id = agentAcc.get(j.agent_id);

    const steps = [
      ["admins", [bundle.admin]], ["agents", bundle.agents], ["programs", bundle.programs], ["closing_groups", bundle.groups],
      ["members", bundle.members], ["dues", bundle.dues], ["transactions", bundle.transactions], ["join_fee_payments", bundle.joinFees],
      ["agent_commission_payouts", bundle.payouts], ["agent_commissions", bundle.commissions],
    ];
    let k = 0;
    for (const [table, rows] of steps) {
      if (isCancelled()) throw new Error("Rok diya gaya");
      k++;
      await insertRows(client, table, rows, { onChunk: (d, tt) => progress("write", total + 1 + k * 0.8, total + 9, `${table}: ${d}/${tt}`) });
    }
    await insertRows(client, "accounts", finalAccounts.map(({ password, generated, ...a }) => a));

    // joining fee totals follow the payments (new-trust source), registration counters follow the numbers used
    if (bundle.recalcJoinFees) {
      await client.query(`
        UPDATE members m SET join_fees_paid_amount = s.paid, join_fees_remaining_amount = GREATEST(m.join_fees - s.paid, 0),
          join_fees_done = (m.join_fees > 0 AND s.paid >= m.join_fees)
        FROM (SELECT x.id, LEAST(COALESCE(sum(j.amount), 0), 2147483647)::int AS paid
              FROM members x JOIN programs p ON p.id = x.program_id LEFT JOIN join_fee_payments j ON j.member_id = x.id
              WHERE p.admin_id = $1 GROUP BY x.id) s
        WHERE s.id = m.id`, [adminId]);
    }
    await client.query(`
      -- integer column: a reg. no. with 10+ digits (phone number, year+serial) is not a counter → ignored
      UPDATE programs p SET reg_counter = LEAST(GREATEST(p.reg_counter::bigint, COALESCE(x.mx, 0)), 2147483647)::int,
        member_counter = LEAST(GREATEST(p.member_counter::bigint, COALESCE(x.mn, 0)), 2147483647)::int
      FROM (SELECT m.program_id, max(NULLIF(regexp_replace(m.registration_number, '\\D', '', 'g'), '')::bigint) FILTER (WHERE length(regexp_replace(m.registration_number, '\\D', '', 'g')) BETWEEN 1 AND 9) AS mx,
                   max(m.member_number) AS mn
            FROM members m GROUP BY m.program_id) x
      WHERE x.program_id = p.id AND p.admin_id = $1`, [adminId]);
    progress("write", total + 9, total + 9, "commit…");
    if (isCancelled()) throw new Error("Rok diya gaya");
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { logins, skippedLogins };
}
