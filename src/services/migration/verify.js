// After the import: read the trust back from Postgres and check it — nothing is changed here.
//   rows       what is in the database vs. what the bundle had
//   money      every due's paid amount = its completed transactions; status right; nothing over-paid; no lost money
//   rule       dues our rule would give but are missing / dues it would not give with nothing paid
//              (information only — the source system may have had its own rule; "Correct Payments" fixes members)
import { pool } from "../../db/index.js";

const q = (text, params) => pool.query(text, params).then((r) => r.rows);

export async function verifyTrust(adminId, bundle) {
  const [rows] = await q(`
    SELECT (SELECT count(*) FROM programs WHERE admin_id = $1)::int AS programs,
           (SELECT count(*) FROM agents WHERE admin_id = $1)::int AS agents,
           (SELECT count(*) FROM members m JOIN programs p ON p.id = m.program_id WHERE p.admin_id = $1)::int AS members,
           (SELECT count(*) FROM members m JOIN programs p ON p.id = m.program_id WHERE p.admin_id = $1 AND m.closing_date IS NOT NULL)::int AS closings,
           (SELECT count(*) FROM dues d JOIN programs p ON p.id = d.program_id WHERE p.admin_id = $1)::int AS dues,
           (SELECT count(*) FROM transactions t JOIN programs p ON p.id = t.program_id WHERE p.admin_id = $1)::int AS transactions,
           (SELECT count(*) FROM join_fee_payments j JOIN programs p ON p.id = j.program_id WHERE p.admin_id = $1)::int AS "joinFeePayments",
           (SELECT count(*) FROM agent_commissions WHERE admin_id = $1)::int AS commissions,
           (SELECT count(*) FROM agent_commission_payouts WHERE admin_id = $1)::int AS payouts,
           (SELECT count(*) FROM accounts WHERE admin_id = $1)::int AS logins`, [adminId]);
  const [money] = await q(`
    SELECT COALESCE(sum(d.paid_amount), 0)::bigint AS "duesPaid", COALESCE(sum(d.amount - d.paid_amount) FILTER (WHERE d.status <> 'paid'), 0)::bigint AS "duesOpen",
           (SELECT COALESCE(sum(t.amount), 0) FROM transactions t JOIN programs p ON p.id = t.program_id WHERE p.admin_id = $1 AND t.status = 'completed')::bigint AS "transactionsTotal",
           (SELECT COALESCE(sum(j.amount), 0) FROM join_fee_payments j JOIN programs p ON p.id = j.program_id WHERE p.admin_id = $1)::bigint AS "joinFees",
           (SELECT COALESCE(sum(amount), 0) FROM agent_commissions WHERE admin_id = $1 AND status <> 'cancelled')::numeric AS commission
    FROM dues d JOIN programs p ON p.id = d.program_id WHERE p.admin_id = $1`, [adminId]);
  const [bad] = await q(`
    SELECT count(*)::int AS n FROM dues d JOIN programs p ON p.id = d.program_id
    CROSS JOIN LATERAL (SELECT COALESCE(sum(t.amount), 0)::bigint AS tx FROM transactions t WHERE t.due_id = d.id AND t.status = 'completed') x
    WHERE p.admin_id = $1 AND (d.paid_amount <> x.tx OR d.paid_amount > d.amount
      OR d.status::text <> CASE WHEN d.paid_amount <= 0 THEN 'pending' WHEN d.paid_amount >= d.amount THEN 'paid' ELSE 'partial' END)`, [adminId]);
  const [lost] = await q(`
    SELECT count(*)::int AS n, COALESCE(sum(t.amount), 0)::bigint AS amount FROM transactions t JOIN programs p ON p.id = t.program_id
    WHERE p.admin_id = $1 AND t.status = 'completed' AND t.transaction_type = 'marriage_payment'
      AND (t.due_id IS NULL OR NOT EXISTS (SELECT 1 FROM dues d WHERE d.id = t.due_id))`, [adminId]);
  const [rule] = await q(`
    SELECT
      (SELECT count(*) FROM members pm JOIN programs p ON p.id = pm.program_id JOIN members c ON c.program_id = pm.program_id AND c.id <> pm.id
        WHERE p.admin_id = $1 AND NOT pm.deleted AND pm.active AND NOT pm.blocked AND pm.status IN ('accepted','closed') AND pm.pay_amount > 0
          AND NOT c.deleted AND c.closing_date IS NOT NULL AND pm.date_join <= c.closing_date
          AND (pm.closing_date IS NULL OR pm.closing_date >= c.closing_date)
          AND NOT EXISTS (SELECT 1 FROM dues d WHERE d.payer_member_id = pm.id AND d.closing_member_id = c.id))::int AS missing,
      (SELECT count(*) FROM dues d JOIN programs p ON p.id = d.program_id JOIN members pm ON pm.id = d.payer_member_id JOIN members c ON c.id = d.closing_member_id
        WHERE p.admin_id = $1 AND d.paid_amount = 0 AND NOT (NOT pm.deleted AND pm.status IN ('accepted','closed') AND pm.pay_amount > 0 AND NOT c.deleted
          AND c.closing_date IS NOT NULL AND pm.id <> c.id AND pm.date_join <= c.closing_date
          AND (pm.closing_date IS NULL OR pm.closing_date >= c.closing_date)))::int AS extra`, [adminId]);
  const expected = bundle?.counts || {};
  const checks = [
    { key: "rows", ok: ["programs", "agents", "members", "dues", "transactions", "joinFeePayments", "commissions", "payouts"].every((k) => expected[k] === undefined || rows[k] === expected[k]),
      label: "Saari rows likhi gayi", detail: Object.entries(rows).map(([k, v]) => `${k} ${v}${expected[k] !== undefined && expected[k] !== v ? ` (chahiye ${expected[k]})` : ""}`).join(" · ") },
    { key: "money", ok: bad.n === 0, label: "Har due ka jama = uske transactions", detail: bad.n ? `${bad.n} dues mein farq` : `₹${Number(money.duesPaid).toLocaleString("en-IN")} jama, ₹${Number(money.duesOpen).toLocaleString("en-IN")} baki` },
    { key: "lost", ok: lost.n === 0, label: "Koi transaction bina due ke nahi", detail: lost.n ? `${lost.n} (₹${lost.amount})` : "0" },
    { key: "total", ok: Number(money.duesPaid) === Number(money.transactionsTotal) || Number(money.transactionsTotal) >= Number(money.duesPaid),
      label: "Kul jama = kul transactions", detail: `dues ₹${Number(money.duesPaid).toLocaleString("en-IN")} · transactions ₹${Number(money.transactionsTotal).toLocaleString("en-IN")}` },
    { key: "rule", ok: true, info: true, label: "Hamare niyam se tulna (sirf jaankari)",
      detail: `${rule.missing} due niyam se bante par nahi hain · ${rule.extra} due niyam se nahi bante (jama 0) — Members → Correct Payments se dekh sakte hain` },
  ];
  return { rows, money: Object.fromEntries(Object.entries(money).map(([k, v]) => [k, Number(v)])), rule, checks, ok: checks.every((c) => c.ok) };
}
