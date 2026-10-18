// Mobile app, after login: everything the app needs in one call — who I am, my trust's branding
// and colours, the developer's feature switches, the yojna list, UPI id for paying.
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route } from "@/lib/http.js";
import { forbidden } from "@/lib/errors.js";
import { normalizeTrust } from "@/lib/trust/profile.js";
import { appLogo } from "@/services/mobileApp.js";
import { appPalette } from "@/lib/theme/themes.js";
import { normalizeReceiptSettings } from "@/lib/receiptSettings.js";

export const dynamic = "force-dynamic";

export const GET = route(async ({ auth }) => {
  if (!["agent", "member"].includes(auth.role)) throw forbidden("Ye app agent aur member ke liye hai");
  const ad = await db.query.admins.findFirst({ where: eq(schema.admins.id, auth.adminId) });
  const trust = normalizeTrust(ad?.trustInfo || {});
  const agent = auth.agentId ? await db.query.agents.findFirst({ where: eq(schema.agents.id, auth.agentId) }) : null;
  let member = null;
  if (auth.memberId) {
    const { rows: [m] } = await db.execute(sql`
      SELECT m.id, m.program_id, m.display_name, m.father_name, m.registration_number, m.application_number, m.phone,
             m.village, m.district, m.state, m.photo_url, m.status::text AS status, m.closing_date, m.date_join, m.pay_amount,
             m.guardian, m.guardian_relation, m.agent_id, a.display_name AS agent_name, a.phone AS agent_phone
      FROM members m LEFT JOIN agents a ON a.id = m.agent_id WHERE m.id = ${auth.memberId}`);
    member = m || null;
  }
  const { rows: programs } = await db.execute(sql`
    SELECT id, name, extra->>'hiname' AS hiname, is_selected FROM programs WHERE admin_id = ${auth.adminId} ORDER BY created_at DESC`);
  const rs = normalizeReceiptSettings(ad?.extra?.receipt);
  const f = auth.features || {};
  return {
    role: auth.role,
    user: { accountId: auth.accountId, displayName: auth.displayName, agentId: auth.agentId, memberId: auth.memberId },
    agent: agent ? { id: agent.id, displayName: agent.displayName, phone: agent.phone, email: agent.email, photoUrl: agent.photoUrl || agent.photoURL || "" } : null,
    member,
    programs: auth.role === "member" && member ? programs.filter((p) => p.id === member.program_id) : programs,
    trust: {
      name: trust.name, shortName: trust.shortName, cityState: trust.cityState, address: trust.address, contact: trust.contact,
      email: trust.email, logo: appLogo(trust.logo), topTitle: trust.topTitle || [],
    },
    palette: appPalette(ad?.extra?.theme),
    features: f,
    upi: f.upiQr !== false && rs.upiId ? { id: rs.upiId, name: rs.upiName || trust.name } : null,
  };
});
