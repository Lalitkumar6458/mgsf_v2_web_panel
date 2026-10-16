// "Ye member pehle se to nahi hai?" — look across ALL yojna of the trust while a member is being
// added / edited: same Aadhaar, same mobile, or same name + father's name.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

const digits = (v) => String(v || "").replace(/\D/g, "");
const norm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");

export async function findDuplicates(adminId, { aadhaarNo, phone, name, fatherName, excludeId } = {}) {
  const a = digits(aadhaarNo), p = digits(phone).slice(-10), n = norm(name), f = norm(fatherName);
  const conds = [];
  if (a.length === 12) conds.push(sql`m.aadhaar_no = ${a}`);
  if (p.length === 10) conds.push(sql`(right(regexp_replace(m.phone, '\\D', '', 'g'), 10) = ${p} OR right(regexp_replace(m.phone_alt, '\\D', '', 'g'), 10) = ${p})`);
  if (n.length >= 2 && f.length >= 2) conds.push(sql`(lower(trim(m.display_name)) = ${n} AND lower(trim(m.father_name)) = ${f})`);
  if (!conds.length) return [];
  const { rows } = await db.execute(sql`
    SELECT m.id, m.display_name, m.father_name, m.registration_number, m.application_number, m.village, m.phone, m.phone_alt,
           m.aadhaar_no, m.status, m.closing_date, m.blocked, p.id AS program_id, p.name AS program_name
    FROM members m JOIN programs p ON p.id = m.program_id
    WHERE p.admin_id = ${adminId} AND NOT m.deleted AND m.status <> 'rejected'
      ${excludeId ? sql`AND m.id <> ${excludeId}` : sql``}
      AND (${sql.join(conds, sql` OR `)})
    ORDER BY m.created_at DESC LIMIT 20`);
  return rows.map((r) => {
    const reasons = [];
    if (a.length === 12 && r.aadhaar_no === a) reasons.push("aadhaar");
    const ph = [digits(r.phone).slice(-10), digits(r.phone_alt).slice(-10)];
    if (p.length === 10 && ph.includes(p)) reasons.push("phone");
    if (n && f && norm(r.display_name) === n && norm(r.father_name) === f) reasons.push("name");
    return {
      id: r.id, displayName: r.display_name, fatherName: r.father_name, registrationNumber: r.registration_number,
      applicationNumber: r.application_number, village: r.village, programId: r.program_id, programName: r.program_name,
      status: r.closing_date ? "closed" : r.blocked ? "blocked" : r.status, reasons,
    };
  });
}
