import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { badRequest, forbidden } from "@/lib/errors.js";
import { camel } from "@/lib/case.js";
import { toLegacyMember } from "@/lib/client/legacy.js";

/**
 * Closing Payments page: every accepted member with his closing payment totals
 * (same response as the old Firestore route).  GET ?programId=
 */
export const GET = route(async ({ auth, query }) => {
  const programId = query.get("programId");
  if (!programId) throw badRequest("programId required");
  await getProgramFor(auth, programId);
  if (auth.role === "member") throw forbidden();

  // per-member totals from the covering index (dues_payer_cover_idx); only the columns the page uses
  const { rows } = await db.execute(sql`
    SELECT m.id, m.program_id, m.display_name, m.father_name, m.registration_number, m.application_number,
           m.phone, m.photo_url, m.village, m.district, m.state, m.gender, m.agent_id, m.added_by, m.added_by_name,
           m.pay_amount, m.date_join, m.status, m.active, m.blocked, m.deleted, m.closing_date, m.created_at, m.updated_at,
           a.display_name AS agent_name,
      COALESCE(x.closing_count, 0)::int         AS closing_count,
      COALESCE(x.pending_closing_count, 0)::int AS pending_closing_count,
      COALESCE(x.paid_closing_count, 0)::int    AS paid_closing_count,
      COALESCE(x.total_amount, 0)::int          AS total_amount,
      COALESCE(x.total_paid, 0)::int            AS total_paid
    FROM members m
    LEFT JOIN agents a ON a.id = m.agent_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS closing_count,
             count(*) FILTER (WHERE d.status <> 'paid') AS pending_closing_count,
             count(*) FILTER (WHERE d.status = 'paid')  AS paid_closing_count,
             sum(d.amount) AS total_amount, sum(d.paid_amount) AS total_paid
      FROM dues d WHERE d.payer_member_id = m.id
    ) x ON true
    WHERE m.program_id = ${programId} AND NOT m.deleted AND m.active AND NOT m.blocked AND m.status = 'accepted'
      ${auth.role === "agent" ? sql`AND m.agent_id = ${auth.agentId}` : sql``}
    ORDER BY m.created_at DESC`);

  const summary = { total: rows.length, totalAmount: 0, totalPaid: 0, totalPending: 0, membersWithPending: 0 };
  const members = camel(rows).map((r) => {
    const totalPending = Math.max(0, r.totalAmount - r.totalPaid);
    summary.totalAmount += r.totalAmount;
    summary.totalPaid += r.totalPaid;
    summary.totalPending += totalPending;
    if (totalPending > 0) summary.membersWithPending++;
    return {
      ...toLegacyMember(r),
      key: r.id,
      closingCount: r.closingCount,
      pendingClosingCount: r.pendingClosingCount,
      paidClosingCount: r.paidClosingCount,
      totalAmount: r.totalAmount,
      totalPaid: r.totalPaid,
      totalPending,
      paidPct: r.totalAmount > 0 ? Math.round((r.totalPaid / r.totalAmount) * 100) : 0,
    };
  });
  return { members, summary };
});
