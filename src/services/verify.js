// Public verification behind the QR codes on paid receipts (and certificates).
// Shows only what is printed on the paper anyway — enough to tell a real one from a fake.
import { sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { db } from "../db/index.js";
import { normalizeTrust } from "../lib/trust/profile.js";

const mask = (s) => {
  s = String(s || "");
  return s.length <= 4 ? s : `${"•".repeat(Math.min(6, s.length - 4))}${s.slice(-4)}`;
};

/** Receipt by its register code → what the verify page shows (null = not ours / not found). */
export async function verifyReceipt(code) {
  const c = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  if (c.length < 6) return null;
  const { rows: [r] } = await db.execute(sql`
    SELECT rr.id, rr.receipt_no, rr.amount, rr.entries, rr.due_ids, rr.created_at,
           m.display_name, m.father_name, m.registration_number, m.village, m.phone,
           p.name AS program_name, ad.trust_info, ad.display_name AS trust_display
    FROM receipt_register rr
    JOIN members m ON m.id = rr.member_id
    JOIN programs p ON p.id = rr.program_id
    JOIN admins ad ON ad.id = rr.admin_id
    WHERE rr.id = ${c}`);
  if (!r) return null;
  const ids = Array.isArray(r.due_ids) ? r.due_ids.filter(Boolean).map(String) : [];
  let stillPaid = ids.length;
  if (ids.length) {
    const { rows: [x] } = await db.execute(sql`
      SELECT count(*) FILTER (WHERE status = 'paid')::int AS paid FROM dues WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    stillPaid = x?.paid ?? 0;
  }
  const trust = normalizeTrust(r.trust_info || {});
  return {
    kind: "receipt",
    code: r.id,
    receiptNo: r.receipt_no,
    amount: r.amount,
    entries: r.entries,
    issuedAt: r.created_at,
    member: { name: r.display_name, fatherName: r.father_name, registrationNumber: r.registration_number, village: r.village, phone: mask(r.phone) },
    program: r.program_name,
    trust: { name: trust.name || r.trust_display, cityState: trust.cityState, contact: trust.contact },
    // a payment on the receipt was reversed after it was printed
    status: ids.length && stillPaid < ids.length ? "changed" : "valid",
    stillPaid, total: ids.length,
  };
}

// ── certificates: a signed member id (no table needed) ──
const certSecret = () => `${process.env.JWT_SECRET || ""}:certificate-verify`;
export const certificateSignature = (memberId) => createHmac("sha256", certSecret()).update(String(memberId)).digest("base64url").slice(0, 12);
export const certificateCode = (memberId) => `${memberId}.${certificateSignature(memberId)}`;

export async function verifyCertificate(token) {
  const t = String(token || "");
  const i = t.lastIndexOf(".");
  if (i < 1) return null;
  const memberId = t.slice(0, i), sig = t.slice(i + 1);
  if (certificateSignature(memberId) !== sig) return null;
  const { rows: [r] } = await db.execute(sql`
    SELECT m.display_name, m.father_name, m.registration_number, m.village, m.status, m.deleted, m.date_join, m.phone,
           p.name AS program_name, ad.trust_info, ad.display_name AS trust_display
    FROM members m JOIN programs p ON p.id = m.program_id JOIN admins ad ON ad.id = p.admin_id
    WHERE m.id = ${memberId}`);
  if (!r) return null;
  const trust = normalizeTrust(r.trust_info || {});
  return {
    kind: "certificate",
    member: { name: r.display_name, fatherName: r.father_name, registrationNumber: r.registration_number, village: r.village, phone: mask(r.phone), joined: r.date_join },
    program: r.program_name,
    trust: { name: trust.name || r.trust_display, cityState: trust.cityState, contact: trust.contact },
    status: r.deleted ? "removed" : r.status === "accepted" ? "valid" : r.status === "closed" ? "closed" : r.status,
  };
}
