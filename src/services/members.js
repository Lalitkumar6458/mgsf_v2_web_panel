// Members: create / accept / update / block / delete / search.
import { sql, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { toDate, todayIST, fmtISO } from "../lib/dates.js";
import { buildRegistrationNumber, defaultMemberPassword } from "../lib/regNumber.js";
import { hashPassword } from "../lib/auth.js";
import { syncNewlyAccepted, resyncPayer, lockProgram, programOf } from "./closings.js";
import { camel } from "../lib/case.js";
import { recordFormJoinFee } from "./joinFees.js";
import { normLimit, limitedPayersOf } from "./fixedLimit.js";

const { members, accounts } = schema;

// Old Firestore name → new column (old names are still accepted so the old UI can be ported quickly)
const ALIASES = {
  photoURL: "photoUrl", extraImageURL: "extraImageUrl", documentFrontURL: "documentFrontUrl",
  documentBackURL: "documentBackUrl", guardianDocumentURL: "guardianDocumentUrl",
  guardianDocumentBackURL: "guardianDocumentBackUrl", bobDate: "birthDate", locactionGroupId: "locationGroupId",
  joinFeesTxtId: "joinFeesTxnId", program: "programId", selectedAgent: "agentId",
};
const TEXT = ["displayName", "fatherName", "gender", "gotra", "jati", "guardian", "guardianRelation", "guardianAadharNo",
  "phone", "phoneAlt", "aadhaarNo", "currentAddress", "village", "district", "state", "pinCode", "ageGroup",
  "ageGroupRange", "memberGroup", "locationGroup", "locationGroupId", "applicationNumber", "joinFeesTxnId",
  "joinFeesPaymentType", "photoUrl", "extraImageUrl", "documentFrontUrl", "documentBackUrl", "guardianDocumentUrl",
  "guardianDocumentBackUrl", "note"];
const INT = ["closingMonths", "payAmount", "joinFees", "joinFeesPaidAmount", "joinFeesRemainingAmount"];
const BOOL = ["joinFeesDone"];
const DATES = ["birthDate", "dateJoin", "membershipClosingDate"];

/** Pick allowed member fields from a request body. */
export function memberFields(body = {}) {
  const src = { ...body };
  for (const [oldK, newK] of Object.entries(ALIASES)) if (src[oldK] !== undefined && src[newK] === undefined) src[newK] = src[oldK];
  const out = {};
  for (const k of TEXT) if (src[k] !== undefined && src[k] !== null) out[k] = String(src[k]).trim();
  for (const k of INT) if (src[k] !== undefined && src[k] !== null && src[k] !== "") out[k] = Math.round(Number(src[k]) || 0);
  for (const k of BOOL) if (src[k] !== undefined) out[k] = Boolean(src[k]);
  for (const k of DATES) if (src[k] !== undefined) out[k] = src[k] ? fmtISO(toDate(src[k])) || null : null;
  if (src.fixedLimit !== undefined) out.fixedLimit = normLimit(src.fixedLimit); // fixed rakam, null = no limit
  if (Array.isArray(src.extraDetails)) out.extraDetails = src.extraDetails.filter((f) => f?.label && f?.value);
  return out;
}

export async function aadhaarTaken(programId, aadhaarNo, exceptId = null, { onlyActive = false } = {}) {
  if (!aadhaarNo) return null;
  const { rows } = await db.execute(sql`
    SELECT id, display_name, registration_number, status FROM members
    WHERE program_id = ${programId} AND aadhaar_no = ${aadhaarNo} AND NOT deleted
      AND status IN ${onlyActive ? sql`('accepted', 'closed')` : sql`('accepted', 'pending', 'closed')`}
      ${exceptId ? sql`AND id <> ${exceptId}` : sql``}
    LIMIT 1`);
  return rows[0] ? camel(rows[0]) : null;
}

/** Old code read ALL members to find this. Now: one indexed query. */
export async function nextApplicationNumber(programId) {
  const { rows: [r] } = await db.execute(sql`
    SELECT max(substring(application_number from '^[0-9]+')::bigint) AS max
    FROM members WHERE program_id = ${programId} AND NOT deleted AND application_number ~ '^[0-9]+'`);
  return String(Math.max(Number(r?.max) || 5500, 5500) + 1);
}

/** Give an accepted member a registration number, member number and login account (inside tx). */
async function activate(tx, memberId, { password: chosenPassword } = {}) {
  const { rows: [m] } = await tx.execute(sql`SELECT * FROM members WHERE id = ${memberId} FOR UPDATE`);
  const { rows: [p] } = await tx.execute(sql`SELECT * FROM programs WHERE id = ${m.program_id} FOR UPDATE`);

  let regNo = m.registration_number;
  if (!regNo) {
    for (let i = 0; i < 5 && !regNo; i++) {
      const { registrationNumber, nextCounter } = buildRegistrationNumber({
        regPrefix: p.reg_prefix, regMode: p.reg_mode, regDigits: p.reg_digits, regStartNo: p.reg_start_no, regCounter: p.reg_counter,
      });
      const { rows: clash } = await tx.execute(sql`SELECT 1 FROM accounts WHERE login_id = ${registrationNumber.toLowerCase()}`);
      if (clash.length && nextCounter === null) continue; // random number already used → try again
      regNo = registrationNumber;
      if (nextCounter !== null) {
        await tx.execute(sql`UPDATE programs SET reg_counter = ${nextCounter} WHERE id = ${p.id}`);
        p.reg_counter = nextCounter;
      }
    }
    if (!regNo) throw conflict("Could not generate a unique registration number, try again");
  }
  const memberNumber = m.member_number || p.member_counter + 1;
  if (!m.member_number) await tx.execute(sql`UPDATE programs SET member_counter = ${memberNumber} WHERE id = ${p.id}`);

  await tx.execute(sql`
    UPDATE members SET status = 'accepted', active = true, registration_number = ${regNo}, member_number = ${memberNumber},
      extra = extra || jsonb_build_object('acceptedAt', now()), updated_at = now()
    WHERE id = ${memberId}`);

  // login account: loginId = registration number, default password = first name (max 5) + birth year (old rule)
  const { rows: acc } = await tx.execute(sql`SELECT id FROM accounts WHERE member_id = ${memberId}`);
  let password = null;
  if (!acc.length) {
    password = chosenPassword || defaultMemberPassword(m.display_name, m.birth_date);
    await tx.insert(accounts).values({
      role: "member", loginId: regNo.toLowerCase(), phone: m.phone, displayName: m.display_name,
      passwordHash: await hashPassword(password), adminId: p.admin_id, memberId,
    });
  }
  const duesCreated = await syncNewlyAccepted(tx, memberId);
  // join fee entered on the form → instalment + agent commission
  const joinFee = await recordFormJoinFee(tx, memberId, { note: "सदस्य जुड़ते समय" });
  return { joinFeeRecorded: joinFee?.amount || 0, registrationNumber: regNo, memberNumber, initialPassword: password, duesCreated };
}

/**
 * Create a member. Admin → accepted straight away. Agent → pending request (admin accepts later).
 */
export async function createMember(program, body, auth) {
  const f = memberFields(body);
  if (!f.displayName) throw badRequest("displayName required");
  if (!f.dateJoin) f.dateJoin = fmtISO(todayIST());
  if (f.payAmount === undefined) f.payAmount = program.defaultPayAmount;

  const requestedAgent = body.agentId || body.selectedAgent || null;
  const agentId = auth.role === "agent" ? auth.agentId : body.addedBy === "admin" ? null : requestedAgent;
  let addedByName = "Admin";
  if (agentId) {
    const ag = await db.query.agents.findFirst({ where: eq(schema.agents.id, agentId) });
    if (!ag || ag.adminId !== program.adminId) throw badRequest("Agent not found");
    addedByName = ag.displayName;
  }
  const dup = await aadhaarTaken(program.id, f.aadhaarNo);
  if (dup) throw conflict(`आधार संख्या ${f.aadhaarNo} पहले से ${dup.displayName} (${dup.registrationNumber}) के नाम दर्ज है`, dup);

  const rest = f;
  return db.transaction(async (tx) => {
    if (auth.role !== "agent") await lockProgram(tx, program.id); // accepted straight away → dues are made
    const [m] = await tx.insert(members).values({
      ...rest,
      programId: program.id,
      agentId,
      addedBy: agentId ? "agent" : "admin",
      addedByName,
      status: "pending",
    }).returning();
    if (auth.role === "agent") return { success: true, member: m, status: "pending" };
    const act = await activate(tx, m.id, { password: body.password ? String(body.password) : undefined });
    return { success: true, member: { ...m, status: "accepted", registrationNumber: act.registrationNumber, memberNumber: act.memberNumber }, ...act };
  });
}

/** Accept a request. `patch` may carry fields set in the accept dialog (join fees, closing months, dateJoin …). */
export async function acceptMember(memberId, patch = {}) {
  return db.transaction(async (tx) => {
    await lockProgram(tx, await programOf(tx, memberId)); // before the member lock (see closings.js)
    const { rows: [m] } = await tx.execute(sql`SELECT status, deleted, program_id, aadhaar_no FROM members WHERE id = ${memberId} FOR UPDATE`);
    if (!m) throw notFound("Member not found");
    if (m.deleted) throw badRequest("Member is deleted");
    if (m.status !== "pending" && m.status !== "rejected") throw conflict(`Member is already ${m.status}`);
    if (m.aadhaar_no) {
      const { rows: dup } = await tx.execute(sql`
        SELECT display_name, registration_number FROM members
        WHERE program_id = ${m.program_id} AND aadhaar_no = ${m.aadhaar_no} AND id <> ${memberId}
          AND NOT deleted AND status IN ('accepted', 'closed') LIMIT 1`);
      if (dup.length) throw conflict(`आधार संख्या ${m.aadhaar_no} पहले से ${dup[0].display_name} (${dup[0].registration_number}) के नाम दर्ज है`);
    }
    const f = memberFields(patch);
    delete f.aadhaarNo;
    if (Object.keys(f).length) await tx.update(members).set(f).where(eq(members.id, memberId));
    return { success: true, ...(await activate(tx, memberId, { password: patch.password })) };
  });
}

export async function setMemberStatus(memberId, status, { reason = "" } = {}) {
  if (!["rejected", "removed"].includes(status)) throw badRequest("status must be rejected or removed");
  return db.transaction(async (tx) => {
    await lockProgram(tx, await programOf(tx, memberId));
    const { rows: [m] } = await tx.execute(sql`SELECT * FROM members WHERE id = ${memberId} FOR UPDATE`);
    if (!m) throw notFound("Member not found");
    if (m.closing_date) throw conflict("Closed member — revert the closing first");
    await tx.execute(sql`UPDATE members SET status = ${status}::member_status, updated_at = now(),
      extra = extra || jsonb_build_object('statusReason', ${reason}::text) WHERE id = ${memberId}`);
    // a removed member stops owing: drop his untouched pending dues
    const r = status === "removed"
      ? await tx.execute(sql`DELETE FROM dues WHERE payer_member_id = ${memberId} AND status = 'pending' AND paid_amount = 0`)
      : { rowCount: 0 };
    await tx.execute(sql`UPDATE accounts SET active = false WHERE member_id = ${memberId}`);
    return { success: true, status, pendingDuesRemoved: r.rowCount ?? 0 };
  });
}

/** Block / unblock (old toggleMemberBlockStatus). Blocked members get no new dues; existing dues stay. */
export async function setBlocked(memberId, blocked) {
  const [m] = await db.update(members).set({ blocked: !!blocked, active: !blocked }).where(eq(members.id, memberId)).returning({ id: members.id });
  if (!m) throw notFound("Member not found");
  await db.update(accounts).set({ active: !blocked }).where(eq(accounts.memberId, memberId));
  return { success: true, blocked: !!blocked };
}

export async function updateMember(member, body) {
  const f = memberFields(body);
  if (f.aadhaarNo && f.aadhaarNo !== member.aadhaarNo) {
    const dup = await aadhaarTaken(member.programId, f.aadhaarNo, member.id);
    if (dup) throw conflict(`आधार संख्या ${f.aadhaarNo} पहले से दर्ज है`, dup);
  }
  if (body.agentId !== undefined || body.selectedAgent !== undefined) {
    const agentId = body.agentId ?? body.selectedAgent ?? null;
    if (agentId) {
      const ag = await db.query.agents.findFirst({ where: eq(schema.agents.id, agentId) });
      if (!ag || ag.adminId !== member.program.adminId) throw badRequest("Agent not found");
      f.agentId = agentId; f.addedBy = "agent"; f.addedByName = ag.displayName;
    } else {
      f.agentId = null; f.addedBy = "admin"; f.addedByName = "Admin";
    }
  }
  // free-form data the closing PDF drawer saves (old member.closingData)
  if (body.closingData && typeof body.closingData === "object") {
    await db.execute(sql`UPDATE members SET extra = extra || jsonb_build_object('closingData', ${JSON.stringify(body.closingData)}::jsonb), updated_at = now() WHERE id = ${member.id}`);
  }
  if (!Object.keys(f).length) return { success: true, member };
  // join date changed → his closing dues follow the new date (refused if money already received
  // for a closing he would no longer owe); same transaction, so nothing is half-done
  const joinChanged = f.dateJoin && f.dateJoin !== (member.dateJoin ? String(member.dateJoin).slice(0, 10) : null);
  // pay amount set to 0 (pays nothing) or back from 0 → his pending entries follow
  const payChanged = f.payAmount !== undefined && (Number(f.payAmount) > 0) !== (Number(member.payAmount) > 0);
  // fixed rakam set / changed / removed → his dues are cut to it (or grow back)
  const limitChanged = f.fixedLimit !== undefined && (f.fixedLimit ?? null) !== (member.fixedLimit ?? null);
  let dues = null;
  const [m] = await db.transaction(async (tx) => {
    if (joinChanged || payChanged || limitChanged) await lockProgram(tx, member.programId);
    const res = await tx.update(members).set(f).where(eq(members.id, member.id)).returning();
    if (joinChanged || payChanged || limitChanged) dues = await resyncPayer(tx, member.id, { strict: !!joinChanged });
    return res;
  });
  if (f.joinFeesPaidAmount !== undefined && Number(f.joinFeesPaidAmount) > Number(member.joinFeesPaidAmount || 0)) {
    await db.transaction((tx) => recordFormJoinFee(tx, member.id, { previousPaid: Number(member.joinFeesPaidAmount || 0), note: "सदस्य संपादन से" }));
  }
  if (f.displayName || f.phone) {
    await db.update(accounts).set({ displayName: m.displayName, phone: m.phone }).where(eq(accounts.memberId, m.id));
  }
  return { success: true, member: m, ...(dues ? { duesAdded: dues.added, duesRemoved: dues.removed } : {}) };
}

export async function softDeleteMember(memberId) {
  return db.transaction(async (tx) => {
    await lockProgram(tx, await programOf(tx, memberId));
    const { rows: [paid] } = await tx.execute(sql`SELECT count(*)::int AS n FROM dues WHERE (payer_member_id = ${memberId} OR closing_member_id = ${memberId}) AND paid_amount > 0`);
    await tx.execute(sql`UPDATE members SET deleted = true, active = false, updated_at = now() WHERE id = ${memberId}`);
    // his own untouched dues as a payer, and — if he was a closing — nobody owes his (deleted) closing any more
    const limited = (await limitedPayersOf(tx, memberId)).filter((x) => x !== memberId);
    const r = await tx.execute(sql`
      DELETE FROM dues WHERE (payer_member_id = ${memberId} OR closing_member_id = ${memberId})
        AND status = 'pending' AND paid_amount = 0`);
    // fixed-limit payers: what his closing used of their limit is free again
    for (const pid of limited) await resyncPayer(tx, pid, { strict: false });
    await tx.execute(sql`UPDATE accounts SET active = false WHERE member_id = ${memberId}`);
    return { success: true, pendingDuesRemoved: r.rowCount ?? 0, keptPaidDues: paid.n };
  });
}

/** Search / list with paging. Old UI loaded every member into the browser; now the DB filters. */
export async function listMembers(programId, { status, agentId, q, closed, includeDeleted, page = 1, pageSize = 50, sort = "newest" } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 1000);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
  const like = q ? `%${q}%` : null;
  const order = {
    newest: sql`m.created_at DESC`,
    name: sql`m.display_name ASC`,
    regno: sql`m.registration_number ASC`,
    application: sql`substring(m.application_number from '^[0-9]+')::bigint ASC NULLS LAST, m.application_number`,
  }[sort] || sql`m.created_at DESC`;

  const { rows } = await db.execute(sql`
    SELECT m.*, a.display_name AS agent_name, g.name AS closing_group_name,
      COALESCE(x.open_dues, 0)::int AS open_dues, COALESCE(x.open_amount, 0)::int AS open_amount, COALESCE(x.paid_total, 0)::int AS paid_total,
      count(*) OVER()::int AS total_count
    FROM members m
    LEFT JOIN agents a ON a.id = m.agent_id
    LEFT JOIN closing_groups g ON g.id = m.closing_group_id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE d.status <> 'paid') AS open_dues, sum(d.amount - d.paid_amount) AS open_amount, sum(d.paid_amount) AS paid_total
      FROM dues d WHERE d.payer_member_id = m.id
    ) x ON true
    WHERE m.program_id = ${programId}
      ${includeDeleted ? sql`` : sql`AND NOT m.deleted`}
      ${status ? sql`AND m.status = ${status}::member_status` : sql``}
      ${agentId ? sql`AND m.agent_id = ${agentId}` : sql``}
      ${closed === "true" ? sql`AND m.closing_date IS NOT NULL` : closed === "false" ? sql`AND m.closing_date IS NULL` : sql``}
      ${like ? sql`AND (m.display_name ILIKE ${like} OR m.father_name ILIKE ${like} OR m.registration_number ILIKE ${like}
                OR m.application_number ILIKE ${like} OR m.phone ILIKE ${like} OR m.village ILIKE ${like} OR m.aadhaar_no ILIKE ${like})` : sql``}
    ORDER BY ${order}
    LIMIT ${size} OFFSET ${offset}`);
  const total = rows[0]?.total_count || 0;
  rows.forEach((r) => delete r.total_count);
  return { members: camel(rows), total, page: Number(page) || 1, pageSize: size };
}
