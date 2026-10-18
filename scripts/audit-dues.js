// Read-only check of the live book — changes NOTHING.   node --env-file=.env scripts/audit-dues.js
// Per program it lists:
//   MISSING  a member owes a closing by THE RULE but has no due for it
//   EXTRA    a due that the rule does not give and nothing is paid on it (safe to remove via "Correct Payments")
//   MONEY    due.paid_amount ≠ sum of its completed transactions, or wrong status / over-paid
//   LOST     completed transaction without a due
// Blocked members are skipped for MISSING (by design they get no new dues while blocked).
import pg from "pg";

pg.types.setTypeParser(1082, (v) => v);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params) => pool.query(text, params).then((r) => r.rows);

const programs = await q(`SELECT p.id, p.name, coalesce(a.trust_info->>'name', a.display_name) AS trust
  FROM programs p JOIN admins a ON a.id = p.admin_id ORDER BY a.created_at, p.created_at`);
let bad = 0;
for (const p of programs) {
  const missing = await q(`
    SELECT pm.display_name AS payer, pm.registration_number AS reg, c.display_name AS closing, c.closing_date
    FROM members pm JOIN members c ON c.program_id = pm.program_id AND c.id <> pm.id
    WHERE pm.program_id = $1 AND NOT pm.deleted AND pm.active AND NOT pm.blocked AND pm.status IN ('accepted','closed')
      AND pm.pay_amount > 0 AND NOT c.deleted AND c.closing_date IS NOT NULL
      AND pm.date_join <= c.closing_date AND (pm.closing_date IS NULL OR pm.closing_date >= c.closing_date)
      AND NOT EXISTS (SELECT 1 FROM dues d WHERE d.payer_member_id = pm.id AND d.closing_member_id = c.id)
    ORDER BY c.closing_date, pm.display_name`, [p.id]);
  const extra = await q(`
    SELECT pm.display_name AS payer, pm.registration_number AS reg, c.display_name AS closing, c.closing_date
    FROM dues d JOIN members pm ON pm.id = d.payer_member_id JOIN members c ON c.id = d.closing_member_id
    WHERE d.program_id = $1 AND d.paid_amount = 0 AND NOT (
      NOT pm.deleted AND pm.status IN ('accepted','closed') AND pm.pay_amount > 0 AND NOT c.deleted
      AND c.closing_date IS NOT NULL AND pm.id <> c.id AND pm.date_join <= c.closing_date
      AND (pm.closing_date IS NULL OR pm.closing_date >= c.closing_date))
    ORDER BY c.closing_date, pm.display_name`, [p.id]);
  const money = await q(`
    SELECT pm.display_name AS payer, c.display_name AS closing, d.amount, d.paid_amount, d.status::text AS status, x.tx
    FROM dues d JOIN members pm ON pm.id = d.payer_member_id JOIN members c ON c.id = d.closing_member_id
    CROSS JOIN LATERAL (SELECT COALESCE(sum(t.amount), 0)::int AS tx FROM transactions t WHERE t.due_id = d.id AND t.status = 'completed') x
    WHERE d.program_id = $1 AND (d.paid_amount <> x.tx OR d.paid_amount > d.amount
      OR d.status::text <> CASE WHEN d.paid_amount <= 0 THEN 'pending' WHEN d.paid_amount >= d.amount THEN 'paid' ELSE 'partial' END)`, [p.id]);
  const [lost] = await q(`
    SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::int AS amt FROM transactions t
    WHERE t.program_id = $1 AND t.status = 'completed' AND (t.due_id IS NULL OR NOT EXISTS (SELECT 1 FROM dues d WHERE d.id = t.due_id))`, [p.id]);

  const n = missing.length + extra.length + money.length + lost.n;
  bad += n;
  console.log(`\n■ ${p.trust} — ${p.name}: ${n ? `${n} problem` : "sab sahi ✔"}`);
  const show = (title, rows, fmt) => {
    if (!rows.length) return;
    console.log(`  ${title} (${rows.length})`);
    for (const r of rows.slice(0, 30)) console.log(`    - ${fmt(r)}`);
    if (rows.length > 30) console.log(`    … aur ${rows.length - 30}`);
  };
  show("MISSING due", missing, (r) => `${r.payer} (${r.reg || "-"}) → closing ${r.closing} ${r.closing_date}`);
  show("EXTRA due (kuch jama nahi)", extra, (r) => `${r.payer} (${r.reg || "-"}) → closing ${r.closing} ${r.closing_date}`);
  show("MONEY mismatch", money, (r) => `${r.payer} → ${r.closing}: due ₹${r.amount}, jama ₹${r.paid_amount}, transactions ₹${r.tx}, status ${r.status}`);
  if (lost.n) console.log(`  LOST: ${lost.n} transactions (₹${lost.amt}) bina due ke`);
}
console.log(bad ? `\nKul ${bad} problem — "Correct Payments" screen se member-wise theek karein.` : "\nPoora hisaab sahi hai ✔");
await pool.end();
