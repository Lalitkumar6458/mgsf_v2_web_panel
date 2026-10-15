// Demo / test data: one new yojna with N members, agents, closing groups, closings,
// dues (paid + pending) and payments. Everything gets ids starting with "DEMO-",
// so it never touches real data and can be removed with --remove.
//
//   npm run seed:demo                                   (5000 members, 500 closings, 20 agents, 25 groups)
//   npm run seed:demo -- --members=2000 --closings=100
//   npm run seed:demo -- --admin=trust@mgsf.in          (which trust; default = first trust)
//   npm run seed:demo -- --remove                       (delete the demo yojna and demo agents)
//
// Tip: use a separate database for big tests (e.g. DATABASE_URL=.../mgsf_demo), not the live one.
import pg from "pg";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const N = Math.max(10, Number(args.members || 5000));
const CLOSINGS = Math.min(Math.floor(N / 2), Math.max(0, Number(args.closings ?? 500)));
const AGENTS = Math.max(1, Number(args.agents || 20));
const GROUPS = Math.max(1, Number(args.groups || 25));
const PROGRAM = "DEMO-P";

if (!process.env.DATABASE_URL) {
  console.error("✖ DATABASE_URL not set (.env)");
  process.exit(1);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const t0 = Date.now();
const step = async (label, sql, params) => {
  const t = Date.now();
  const r = await db.query(sql, params);
  console.log(`  ${label.padEnd(28)} ${String(r.rowCount ?? "").padStart(9)}  ${((Date.now() - t) / 1000).toFixed(1)}s`);
  return r;
};

async function removeDemo() {
  // dues / transactions / members / groups go with the program (ON DELETE CASCADE)
  await step("delete demo commission", `DELETE FROM agent_commissions WHERE program_id = $1 OR agent_id LIKE 'DEMO-A%'`, [PROGRAM]);
  await step("delete demo transactions", `DELETE FROM transactions WHERE program_id = $1`, [PROGRAM]);
  await step("delete demo dues", `DELETE FROM dues WHERE program_id = $1`, [PROGRAM]);
  await step("delete demo yojna", `DELETE FROM programs WHERE id = $1`, [PROGRAM]);
  await step("delete demo agents", `DELETE FROM agents WHERE id LIKE 'DEMO-A%'`);
}

try {
  if (args.remove) {
    console.log("Removing demo data…");
    await db.query("BEGIN");
    await removeDemo();
    await db.query("COMMIT");
    console.log(`✔ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    process.exit(0);
  }

  const admin = (await db.query(
    args.admin ? `SELECT id, email FROM admins WHERE lower(email) = lower($1)` : `SELECT id, email FROM admins ORDER BY created_at LIMIT 1`,
    args.admin ? [args.admin] : [],
  )).rows[0];
  if (!admin) {
    console.error(`✖ No trust (admin) found${args.admin ? ` for ${args.admin}` : ""}. Create one first: npm run create-account -- admin ...`);
    process.exit(1);
  }

  console.log(`Demo data for ${admin.email}: ${N} members, ${CLOSINGS} closings, ${AGENTS} agents, ${GROUPS} groups`);
  await db.query("BEGIN");
  await db.query("SET LOCAL synchronous_commit = off");
  await removeDemo(); // re-running replaces the old demo

  await step("yojna", `INSERT INTO programs (id, admin_id, name, hiname, default_pay_amount, reg_prefix, reg_counter, member_counter)
    VALUES ($1, $2, $3, $4, 200, 'DM', $5, $5)`, [PROGRAM, admin.id, `Demo Yojna (${N})`, `डेमो योजना (${N})`, N]);

  // odd agents get commission (join fees 20%, closing 5%), even agents have it off
  await step("agents", `INSERT INTO agents (id, admin_id, display_name, phone, city, commission)
    SELECT 'DEMO-A'||i, $1, 'डेमो एजेंट '||i, '97'||lpad(i::text, 8, '0'),
      (ARRAY['बालोतरा','जोधपुर','पाली','बाड़मेर','सिरोही','जालोर','डीसा'])[1 + i % 7],
      CASE WHEN i % 2 = 1 THEN '{"enabled":true,"joinFees":{"enabled":true,"type":"percentage","value":20},"closing":{"enabled":true,"type":"percentage","value":5}}'::jsonb
           ELSE '{}'::jsonb END
    FROM generate_series(1, $2::int) i`, [admin.id, AGENTS]);

  await step("closing groups", `INSERT INTO closing_groups (id, program_id, name)
    SELECT 'DEMO-G'||i, $1, 'डेमो ग्रुप '||i FROM generate_series(1, $2::int) i`, [PROGRAM, GROUPS]);

  // members joined over the last 3 years; a few pending / rejected / inactive / blocked / no agent
  await step("members", `INSERT INTO members (id, program_id, agent_id, display_name, father_name, registration_number,
      application_number, member_number, status, active, blocked, gender, date_join, pay_amount, join_fees, join_fees_done,
      join_fees_remaining_amount, village, phone, state, district)
    SELECT 'DEMO-M'||i, $1,
      CASE WHEN i % 31 = 0 THEN NULL ELSE 'DEMO-A'||(1 + i % $3::int) END,
      (ARRAY['अमित','भरत','चेतन','दीपक','ईशा','फूलचंद','गीता','हरीश','इंदु','जगदीश','कविता','लक्ष्मण','मीना','नरेश','ओमप्रकाश','पूजा'])[1 + i % 16]
        || ' ' || (ARRAY['घांची','सोलंकी','परमार','राठौड़','भाटी','गहलोत'])[1 + (i / 16) % 6],
      (ARRAY['रामलाल','मोहनलाल','शंकरलाल','भैराराम','पुखराज','हीरालाल'])[1 + i % 6],
      'DM'||lpad(i::text, 6, '0'), i::text, i,
      (CASE WHEN i % 113 = 0 THEN 'pending' WHEN i % 151 = 0 THEN 'rejected' ELSE 'accepted' END)::member_status,
      NOT (i % 37 = 0), (i % 97 = 0),
      CASE WHEN i % 2 = 0 THEN 'male' ELSE 'female' END,
      (current_date - 1095 + (i::bigint * 1090 / $2::int)::int),
      200, 500, i % 6 <> 0, CASE WHEN i % 6 = 0 THEN 500 ELSE 0 END,
      'गाँव '||(i % 120), '9'||lpad((100000000 + i)::text, 9, '0'), 'rajasthan', 'jodhpur'
    FROM generate_series(1, $2::int) i`, [PROGRAM, N, AGENTS]);

  // closings spread over the last ~33 months, members picked evenly from the list, 20 per group
  if (CLOSINGS > 0) {
    await step("closings", `UPDATE members m SET closing_date = (current_date - 1000 + (s.k::bigint * 993 / $1::int)::int),
        closing_group_id = 'DEMO-G'||(1 + ((s.k - 1) * $2::int / $1::int)), closing_at = now()
      FROM (SELECT id AS mid, rn / gap AS k FROM (
              SELECT id, row_number() OVER (ORDER BY member_number) AS rn, greatest(1, count(*) OVER () / $1::int) AS gap FROM members
              WHERE program_id = 'DEMO-P' AND status = 'accepted' AND active AND NOT blocked) a
            WHERE rn % gap = 0 AND rn / gap <= $1::int) s
      WHERE m.id = s.mid`, [CLOSINGS, GROUPS]);

    // dues: every accepted, active, not blocked member who joined on/before the closing and was not closed before it.
    // Closings older than 3 months are ~80% paid; newer ones are pending.
    await step("dues", `INSERT INTO dues (id, program_id, closing_member_id, payer_member_id, amount, paid_amount, status, due_date)
      SELECT 'DEMO-D'||c.id||'-'||p.id, $1, c.id, p.id, 200,
        CASE WHEN c.closing_date < current_date - 90 AND abs(hashtext(c.id||p.id)) % 100 < 80 THEN 200 ELSE 0 END,
        (CASE WHEN c.closing_date < current_date - 90 AND abs(hashtext(c.id||p.id)) % 100 < 80 THEN 'paid' ELSE 'pending' END)::due_status,
        c.closing_date + 30
      FROM members c
      JOIN members p ON p.program_id = $1 AND p.id <> c.id AND p.status = 'accepted' AND p.active AND NOT p.blocked AND NOT p.deleted
        AND p.date_join <= c.closing_date AND (p.closing_date IS NULL OR p.closing_date > c.closing_date)
      WHERE c.program_id = $1 AND c.closing_date IS NOT NULL`, [PROGRAM]);

    await step("payments", `INSERT INTO transactions (id, program_id, transaction_number, batch_id, payer_member_id, closing_member_id,
        due_id, amount, payment_method, payment_date)
      SELECT 'DEMO-T'||d.id, $1, 'TRX-DEMO-'||d.id, 'DEMO-B'||d.id, d.payer_member_id, d.closing_member_id, d.id, 200,
        CASE WHEN abs(hashtext(d.id)) % 3 = 0 THEN 'online' ELSE 'cash' END,
        LEAST(c.closing_date + abs(hashtext(d.id)) % 60, current_date)
      FROM dues d JOIN members c ON c.id = d.closing_member_id
      WHERE d.program_id = $1 AND d.status = 'paid'`, [PROGRAM]);
  }

  // join fees paid on joining → one instalment each, then agent commission (same rule as the app)
  await step("join fee payments", `INSERT INTO join_fee_payments (id, program_id, member_id, amount, payment_mode, payment_date, note, agent_id)
    SELECT 'DEMO-J'||m.id, $1, m.id, m.join_fees, 'cash', m.date_join, 'demo', m.agent_id
    FROM members m WHERE m.program_id = $1 AND m.join_fees_done AND m.join_fees > 0`, [PROGRAM]);
  await step("commission (join fees)", `INSERT INTO agent_commissions (id, admin_id, agent_id, program_id, member_id, source, source_id,
      base_amount, rate_type, rate_value, amount, payment_date)
    SELECT gen_random_uuid()::text, a.admin_id, a.id, jp.program_id, jp.member_id, 'join_fees', jp.id, jp.amount, 'percentage', 20,
      round(jp.amount * 0.20, 2), jp.payment_date
    FROM join_fee_payments jp JOIN members m ON m.id = jp.member_id JOIN agents a ON a.id = m.agent_id
    WHERE jp.program_id = $1 AND (a.commission->>'enabled') = 'true'`, [PROGRAM]);
  await step("commission (closing)", `INSERT INTO agent_commissions (id, admin_id, agent_id, program_id, member_id, closing_member_id,
      source, source_id, base_amount, rate_type, rate_value, amount, payment_date)
    SELECT gen_random_uuid()::text, a.admin_id, a.id, t.program_id, t.payer_member_id, t.closing_member_id, 'closing', t.id, t.amount,
      'percentage', 5, round(t.amount * 0.05, 2), t.payment_date
    FROM transactions t JOIN members p ON p.id = t.payer_member_id JOIN agents a ON a.id = p.agent_id
    WHERE t.program_id = $1 AND t.status = 'completed' AND (a.commission->>'enabled') = 'true'`, [PROGRAM]);

  await db.query("COMMIT");
  await db.query("ANALYZE");
  const s = (await db.query(`SELECT
      (SELECT count(*) FROM members WHERE program_id = $1) members,
      (SELECT count(*) FROM members WHERE program_id = $1 AND closing_date IS NOT NULL) closings,
      (SELECT count(*) FROM dues WHERE program_id = $1) dues,
      (SELECT count(*) FROM dues WHERE program_id = $1 AND status = 'pending') pending,
      (SELECT count(*) FROM transactions WHERE program_id = $1) payments`, [PROGRAM])).rows[0];
  console.log(`\n✔ Done in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${s.members} members, ${s.closings} closings, ${s.dues} dues (${s.pending} pending), ${s.payments} payments`);
  console.log(`  Open the admin panel → choose "Demo Yojna (${N})" in the yojna dropdown at the top.`);
  console.log(`  Remove later with: npm run seed:demo -- --remove`);
} catch (e) {
  await db.query("ROLLBACK").catch(() => {});
  console.error("✖", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
