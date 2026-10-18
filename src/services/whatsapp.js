// WhatsApp messages through the trust's own Gupshup app (Settings → WhatsApp).
//
//   onJoin(adminId, memberId)          member accepted → template "join"    + certificate PDF (once per member)
//   onClosing(adminId, closingId)      new closing     → template "pending" + pending rasid, to every payer who owes
//   bulkPending(adminId, {programId})  panel button    → template "pending" to all members who owe
//   onPayment(adminId, batchId)        payment saved   → template "paid"    + paid rasid of that payment
//   handleCallback(...)                Gupshup → us: delivery status + member replies (inbox)
//
// The PDF is a signed public link (/api/wa/file/<token>/<name>.pdf) that Gupshup downloads.
// Hooks run after the request (lib/push.js later()) — a WhatsApp problem never fails a payment.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { badRequest, notFound } from "../lib/errors.js";
import { normalizeWhatsapp, mergeWhatsapp, publicWhatsapp, ready, waPhone, fill, preview, sampleVars, WA_EVENTS, slotCount } from "../lib/whatsappSettings.js";
import { sendTemplate, sendText } from "../lib/gupshup.js";
import { getTrustFeatures } from "./features.js";
import { fmtDMY } from "../lib/dates.js";

const inList = (ids) => sql.join(ids.map((x) => sql`${x}`), sql`, `);
const amt = (n) => Math.round(Number(n) || 0).toLocaleString("en-IN");
const dmy = (v) => (v ? fmtDMY(v) : "");
const todayDMY = () => dmy(new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** timestamps from raw SQL may come as "2026-10-18 02:38:59.5+00" — send ISO to the browser */
const iso = (v) => { if (!v) return null; const d = v instanceof Date ? v : new Date(String(v).replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
export const origin = (o) => String(o || process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");

/* ── settings ─────────────────────────────────────────────────────────── */

export async function getWhatsapp(adminId) {
  const { rows: [r] } = await db.execute(sql`SELECT extra->'whatsapp' AS w FROM admins WHERE id = ${adminId}`);
  return normalizeWhatsapp(r?.w);
}

async function store(adminId, value) {
  await db.execute(sql`
    UPDATE admins SET extra = jsonb_set(coalesce(extra, '{}'::jsonb), '{whatsapp}', ${JSON.stringify(value)}::jsonb), updated_at = now()
    WHERE id = ${adminId}`);
}

export async function saveWhatsapp(adminId, input) {
  const next = mergeWhatsapp(await getWhatsapp(adminId), input || {});
  if (!next.secret || input?.rotateSecret) next.secret = randomBytes(16).toString("hex"); // "Nayi key banao"

  for (const e of WA_EVENTS) {
    const ev = next.events[e.key];
    if (ev.on && !ev.templateId) throw badRequest(`${e.label}: Template ID daalein (ya ise band karein)`);
  }
  await store(adminId, next);
  return publicWhatsapp(next);
}

/** Settings for the panel + the callback URL to paste into Gupshup. */
export async function whatsappForPanel(adminId, base) {
  let s = await getWhatsapp(adminId);
  if (!s.secret) { s = { ...s, secret: randomBytes(16).toString("hex") }; await store(adminId, s); }
  return {
    settings: publicWhatsapp(s),
    // URL without the key; Gupshup sends the key in a header (WEBHOOK_HEADER)
    callbackUrl: `${origin(base)}/api/whatsapp/callback`,
    callbackHeader: { name: WEBHOOK_HEADER, value: s.secret },
    // for a Gupshup app that cannot add headers: key inside the URL (old style, still works)
    callbackUrlWithKey: `${origin(base)}/api/whatsapp/callback/${adminId}/${s.secret}`,
  };
}

async function active(adminId) {
  const s = await getWhatsapp(adminId);
  if (!ready(s)) return null;
  const f = await getTrustFeatures(adminId);
  if (!f.active || f.flags.whatsappApi === false) return null;
  return s;
}

/* ── signed PDF links ─────────────────────────────────────────────────── */

const SECRET = () => process.env.JWT_SECRET || "dev-secret";
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (p) => createHmac("sha256", SECRET()).update(p).digest("base64url").slice(0, 32);

/** kind: certificate | pendingReceipt | paidReceipt. Valid 30 days (WhatsApp keeps its own copy). */
export function fileToken({ adminId, kind, memberId, batchId = "" }, days = 30) {
  const p = b64(JSON.stringify({ a: adminId, k: kind, m: memberId, b: batchId || "", e: Date.now() + days * 86400e3 }));
  return `${p}.${sign(p)}`;
}
export function readFileToken(token) {
  const [p, s] = String(token || "").split(".");
  if (!p || !s) return null;
  const want = Buffer.from(sign(p)), got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const j = JSON.parse(Buffer.from(p, "base64url").toString());
    if (!j.e || j.e < Date.now()) return null;
    return { adminId: j.a, kind: j.k, memberId: j.m, batchId: j.b || "" };
  } catch { return null; }
}
const FILE_NAME = { certificate: "certificate", pendingReceipt: "baki-rasid", paidReceipt: "rasid" };
export function fileLink(base, t) {
  const o = origin(base);
  if (!o) return "";
  return `${o}/api/wa/file/${fileToken(t)}/${FILE_NAME[t.kind] || "file"}-${String(t.regNo || t.memberId).replace(/[^\w-]/g, "")}.pdf`;
}

/* ── variables per member ─────────────────────────────────────────────── */

/** memberId → { name, regNo, program, …, pendingAmount, closingNames, lastDate } */
export async function memberVars(adminId, memberIds) {
  const ids = [...new Set(memberIds.filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const { rows: [t] } = await db.execute(sql`
    SELECT coalesce(nullif(trust_info->>'name', ''), display_name) AS trust,
           coalesce(nullif(extra->'app'->'support'->>'phone', ''), nullif(phone, ''), '') AS trust_phone
    FROM admins WHERE id = ${adminId}`);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = inList(ids.slice(i, i + 500));
    const { rows } = await db.execute(sql`
      SELECT m.id, m.display_name, m.father_name, m.registration_number, m.village, m.phone, m.phone_alt, m.date_join,
             m.pay_amount, m.status, coalesce(nullif(p.hiname, ''), p.name) AS program, ag.display_name AS agent,
             (SELECT login_id FROM accounts a WHERE a.member_id = m.id AND a.role = 'member' LIMIT 1) AS login_id,
             pd.total AS pending_amount, pd.n AS pending_count, pd.last_date, pd.names
      FROM members m JOIN programs p ON p.id = m.program_id AND p.admin_id = ${adminId}
      LEFT JOIN agents ag ON ag.id = m.agent_id
      LEFT JOIN LATERAL (
        SELECT sum(d.amount - d.paid_amount)::int AS total, count(*)::int AS n, min(d.due_date) AS last_date,
               string_agg(c.display_name || coalesce(' (' || nullif(c.village, '') || ')', ''), ', ' ORDER BY c.closing_date DESC) AS names
        FROM dues d JOIN members c ON c.id = d.closing_member_id
        WHERE d.payer_member_id = m.id AND d.status <> 'paid' AND d.amount > d.paid_amount
      ) pd ON true
      WHERE m.id IN (${chunk})`);
    for (const r of rows) {
      const names = String(r.names || "");
      out.set(r.id, {
        name: r.display_name || "", father: r.father_name || "", regNo: r.registration_number || "",
        program: r.program || "", trust: t?.trust || "", village: r.village || "",
        phone: String(r.phone || "").replace(/\D/g, "").slice(-10), agent: r.agent || "",
        joinDate: dmy(r.date_join), payAmount: amt(r.pay_amount),
        pendingAmount: amt(r.pending_amount), pendingCount: String(r.pending_count || 0),
        closingNames: names.length > 200 ? `${names.slice(0, 197)}…` : names,
        lastDate: dmy(r.last_date), loginId: r.login_id || "", trustPhone: t?.trust_phone || "", today: todayDMY(),
        paidAmount: "", paidCount: "", paidDate: "",
        _phones: [r.phone, r.phone_alt], _pending: Number(r.pending_amount) || 0, _status: r.status,
      });
    }
  }
  return out;
}

/* ── sending ──────────────────────────────────────────────────────────── */

/** WhatsApp rejects empty template values, so an empty slot gets "-". */
export function buildParams(ev, vars) {
  const n = Math.max(slotCount(ev.body), 0) || ev.params.length;
  const list = [];
  for (let i = 0; i < n; i++) list.push(fill(ev.params[i] ?? "", vars).replace(/\s+/g, " ").trim() || "-");
  return list;
}

/**
 * Send one template message per item, one by one (Gupshup limit friendly).
 * items: [{ memberId, vars?, batchId? }]  →  { sent, failed, skipped }
 */
export async function sendEvent(adminId, event, items, { base, settings, force = false } = {}) {
  const s = settings || (await active(adminId));
  const ev = s?.events?.[event];
  if (!s || !ev || (!ev.on && !force) || !ev.templateId) return { sent: 0, failed: 0, skipped: items.length, reason: "off" };
  const vars = await memberVars(adminId, items.map((x) => x.memberId));
  let sent = 0, failed = 0, skipped = 0;
  for (const it of items) {
    const v0 = vars.get(it.memberId);
    const to = v0 && (waPhone(v0._phones[0]) || waPhone(v0._phones[1]));
    if (!v0 || !to) { skipped++; continue; }
    const kind = ev.media !== "none" ? ev.media : null;
    const link = kind ? fileLink(base, { adminId, kind, memberId: it.memberId, batchId: it.batchId, regNo: v0.regNo }) : "";
    const v = { ...v0, ...(it.vars || {}), pdfLink: link };
    const params = buildParams(ev, v);
    const media = link ? { type: "document", link, filename: link.split("/").pop() } : null;
    const r = await sendTemplate(s, { to, templateId: ev.templateId, params, media });
    await db.insert(schema.whatsappMessages).values({
      adminId, direction: "out", phone: to, memberId: it.memberId, event, templateId: ev.templateId, params,
      body: ev.body ? preview(ev.body, params) : params.join(" · "), mediaUrl: link, mediaType: media ? "document" : "",
      status: r.ok ? "submitted" : "failed", providerId: r.messageId || null, error: r.ok ? "" : r.error,
      data: { batchId: it.batchId || undefined, by: it.by || undefined },
    });
    if (r.ok) sent++; else failed++;
    if (items.length > 1) await pause(150);
  }
  return { sent, failed, skipped };
}

/** Member accepted → join message with the certificate (only once per member). */
/**
 * Member added / request accepted with "WhatsApp par welcome bhejein" ticked (default off) →
 * join message + certificate. Only once per member.
 */
export async function onJoin(adminId, memberId, base) {
  const s = await active(adminId);
  if (!s?.events.join.templateId) return null;
  const { rows } = await db.execute(sql`
    SELECT 1 FROM whatsapp_messages WHERE member_id = ${memberId} AND event = 'join' AND direction = 'out' AND status <> 'failed' LIMIT 1`);
  if (rows.length) return { sent: 0, skipped: 1, reason: "already" };
  return sendEvent(adminId, "join", [{ memberId }], { base, settings: s, force: true });
}

/** For the add-member / accept forms: show the WhatsApp tick box? */
export async function joinStatus(adminId) {
  const s = await active(adminId);
  return { ready: !!(s?.events.join.on && s.events.join.templateId), media: s?.events.join.media || "none" };
}

/** Payment saved → paid message to each payer of that batch, with that payment's rasid. */
export async function onPayment(adminId, batchId, base) {
  const s = await active(adminId);
  if (!batchId || !s?.events.paid.on) return null;
  const { rows } = await db.execute(sql`
    SELECT t.payer_member_id AS member_id, sum(t.amount)::int AS total, count(*)::int AS n, max(t.payment_date) AS paid_on
    FROM transactions t WHERE t.batch_id = ${batchId} AND t.status = 'completed' GROUP BY 1`);
  return sendEvent(adminId, "paid", rows.map((r) => ({
    memberId: r.member_id, batchId,
    vars: { paidAmount: amt(r.total), paidCount: String(r.n), paidDate: dmy(r.paid_on) || todayDMY() },
  })), { base, settings: s });
}

/** New closing → pending message to everybody who owes for it (if "nayi closing par" is on). */
export async function onClosing(adminId, closingMemberId, base) {
  const s = await active(adminId);
  if (!s?.events.pending.on || !s.events.pending.onClosing) return null;
  const { rows } = await db.execute(sql`
    SELECT DISTINCT d.payer_member_id AS member_id FROM dues d
    WHERE d.closing_member_id = ${closingMemberId} AND d.status <> 'paid' AND d.amount > d.paid_amount`);
  return sendEvent(adminId, "pending", rows.map((r) => ({ memberId: r.member_id })), { base, settings: s });
}

/** Members who owe (for the bulk button): { count, members: [memberId] } */
export async function pendingAudience(adminId, { programId, memberIds } = {}) {
  const { rows } = await db.execute(sql`
    SELECT DISTINCT d.payer_member_id AS id FROM dues d
    JOIN members m ON m.id = d.payer_member_id AND NOT m.deleted AND m.status IN ('accepted', 'closed')
    JOIN programs p ON p.id = d.program_id AND p.admin_id = ${adminId}
    WHERE d.status <> 'paid' AND d.amount > d.paid_amount
      ${programId ? sql`AND d.program_id = ${programId}` : sql``}
      ${memberIds?.length ? sql`AND d.payer_member_id IN (${inList(memberIds)})` : sql``}`);
  return rows.map((r) => r.id);
}

/** Panel: bulk pending reminder / join / paid to chosen members. Runs in the background. */
export async function bulkSend(adminId, { event = "pending", programId, memberIds } = {}, base, later) {
  const s = await getWhatsapp(adminId);
  if (!ready(s)) throw badRequest("Pehle Settings → WhatsApp mein Gupshup jodein aur WhatsApp chalu karein");
  const f = await getTrustFeatures(adminId);
  if (f.flags.whatsappApi === false) throw badRequest("WhatsApp is panel mein chalu nahi hai");
  const ev = s.events[event];
  if (!ev?.templateId) throw badRequest("Is message ka Template ID set nahi hai");
  let ids = event === "pending" ? await pendingAudience(adminId, { programId, memberIds }) : (memberIds || []);
  if (event !== "pending" && ids.length) {
    const { rows } = await db.execute(sql`SELECT m.id FROM members m JOIN programs p ON p.id = m.program_id AND p.admin_id = ${adminId} WHERE m.id IN (${inList(ids)})`);
    ids = rows.map((r) => r.id);
  }
  if (!ids.length) return { queued: 0 };
  const job = () => sendEvent(adminId, event, ids.map((memberId) => ({ memberId, by: "panel" })), { base, settings: s, force: true });
  if (later) later(job); else await job();
  return { queued: ids.length };
}

/** Test: one message to any number, with a real member's data (or sample data). */
export async function testSend(adminId, { event, phone, memberId }, base) {
  const s = await getWhatsapp(adminId);
  if (!s.apiKey || !s.source || !s.appName) throw badRequest("API key, number aur app naam bharkar Save karein");
  const ev = s.events[event];
  if (!ev?.templateId) throw badRequest("Template ID daalkar Save karein");
  const to = waPhone(phone);
  if (!to) throw badRequest("Sahi mobile number daalein");
  let v = sampleVars();
  let link = "";
  if (memberId) {
    const mv = (await memberVars(adminId, [memberId])).get(memberId);
    if (!mv) throw notFound("Sadasya nahi mila");
    v = { ...v, ...mv, paidAmount: mv.payAmount, paidCount: "1", paidDate: todayDMY() };
    if (ev.media !== "none" && !(ev.media === "pendingReceipt" && !mv._pending)) link = fileLink(base, { adminId, kind: ev.media, memberId, regNo: mv.regNo });
  }
  if (!link && ev.media !== "none") link = "https://www.buildquickbots.com/whatsapp/media/sample/pdf/sample01.pdf"; // Gupshup's own sample PDF
  v.pdfLink = link;
  const params = buildParams(ev, v);
  const r = await sendTemplate(s, { to, templateId: ev.templateId, params, media: link ? { type: "document", link, filename: link.split("/").pop() } : null });
  await db.insert(schema.whatsappMessages).values({
    adminId, phone: to, memberId: memberId || null, event: "test", templateId: ev.templateId, params,
    body: ev.body ? preview(ev.body, params) : params.join(" · "), mediaUrl: link, mediaType: link ? "document" : "",
    status: r.ok ? "submitted" : "failed", providerId: r.messageId || null, error: r.ok ? "" : r.error, data: { test: event },
  });
  if (!r.ok) throw badRequest(r.error);
  return { messageId: r.messageId, params };
}

/* ── callback (Gupshup → us) ──────────────────────────────────────────── */

/** Header Gupshup sends with each callback (Webhook → Headers). Also accepted: x-api-key, apikey, Authorization: Bearer <key>. */
export const WEBHOOK_HEADER = "x-webhook-key";
export function keyFromHeaders(h) {
  const get = (k) => (typeof h?.get === "function" ? h.get(k) : h?.[k]) || "";
  const bearer = String(get("authorization")).match(/^Bearer\s+(.+)$/i)?.[1] || "";
  return String(get(WEBHOOK_HEADER) || get("x-api-key") || get("apikey") || bearer).trim();
}

const RANK = { queued: 0, submitted: 1, enqueued: 2, sent: 3, delivered: 4, read: 5 };

/** Gupshup V2 payloads: "message-event" (status) and "message" (member wrote to us). */
/**
 * One callback URL for the whole server (/api/whatsapp/callback): which trust is it for?
 *   1. the key header (each trust has its own key)
 *   2. Gupshup's "app" field in every payload = the trust's Gupshup app name
 *   3. only one trust has WhatsApp set up → that one
 */
export async function trustForCallback(body, key) {
  if (key) {
    const { rows } = await db.execute(sql`SELECT id FROM admins WHERE extra->'whatsapp'->>'secret' = ${key} LIMIT 2`);
    return rows.length === 1 ? { adminId: rows[0].id, key } : null; // wrong key → nobody
  }
  const app = String(body?.app || "").trim().toLowerCase();
  if (app) {
    const { rows } = await db.execute(sql`
      SELECT id FROM admins WHERE lower(trim(extra->'whatsapp'->>'appName')) = ${app}
      ORDER BY (extra->'whatsapp'->>'enabled')::boolean DESC NULLS LAST LIMIT 2`);
    if (rows.length === 1) return { adminId: rows[0].id };
    if (rows.length > 1) { console.warn("[whatsapp callback] same Gupshup app name on 2 trusts:", app); return null; }
  }
  const { rows } = await db.execute(sql`SELECT id FROM admins WHERE coalesce(extra->'whatsapp'->>'apiKey', '') <> '' LIMIT 2`);
  return rows.length === 1 ? { adminId: rows[0].id } : null;
}

/**
 * secret: the key from the URL or header. { keyOptional: true } (plain URL /callback/<trustId>):
 * no key = accepted (Gupshup can't always send one); a key that is sent must be right.
 */
export async function handleCallback(adminId, secret, body, { keyOptional = false } = {}) {
  const s = await getWhatsapp(adminId);
  if (!s.secret && !keyOptional) return { ok: false, reason: "secret" };
  if (secret || !keyOptional) {
    const a = Buffer.from(String(s.secret || "")), b = Buffer.from(String(secret || ""));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "secret" };
  }
  const p = body?.payload || {};
  if (body?.type === "message-event") {
    const st = String(p.type || "");
    const ids = [p.id, p.gsId].filter(Boolean);
    if (!ids.length || !(st in RANK || st === "failed")) return { ok: true, ignored: st };
    const err = st === "failed" ? `${p.payload?.code ? `${p.payload.code}: ` : ""}${p.payload?.reason || "failed"}`.slice(0, 300) : "";
    // gsId of a DLR event = our messageId; keep the WhatsApp id too
    await db.execute(sql`
      UPDATE whatsapp_messages SET
        status = CASE WHEN ${st} = 'failed' THEN 'failed'
                      WHEN status = 'failed' THEN status
                      WHEN (CASE status WHEN 'queued' THEN 0 WHEN 'submitted' THEN 1 WHEN 'enqueued' THEN 2 WHEN 'sent' THEN 3 WHEN 'delivered' THEN 4 WHEN 'read' THEN 5 ELSE 0 END) < ${RANK[st] ?? 0} THEN ${st}
                      ELSE status END,
        error = CASE WHEN ${st} = 'failed' THEN ${err} ELSE error END,
        gs_id = coalesce(gs_id, ${p.payload?.whatsappMessageId || (p.gsId ? p.id : null)}),
        updated_at = now()
      WHERE admin_id = ${adminId} AND (provider_id IN (${inList(ids)}) OR gs_id IN (${inList(ids)}))`);
    return { ok: true };
  }
  if (body?.type === "message") {
    const phone = waPhone(p.sender?.phone || p.source);
    if (!phone) return { ok: true, ignored: "phone" };
    const inner = p.payload || {};
    const text = String(inner.text || inner.caption || inner.title || inner.name || (p.type === "location" ? `📍 ${inner.latitude},${inner.longitude}` : "") || `[${p.type || "message"}]`).slice(0, 4000);
    const ten = phone.slice(-10);
    const { rows: [m] } = await db.execute(sql`
      SELECT m.id FROM members m JOIN programs p ON p.id = m.program_id AND p.admin_id = ${adminId}
      WHERE NOT m.deleted AND (right(regexp_replace(coalesce(m.phone, ''), '\\D', '', 'g'), 10) = ${ten}
         OR right(regexp_replace(coalesce(m.phone_alt, ''), '\\D', '', 'g'), 10) = ${ten})
      ORDER BY (m.status = 'accepted') DESC, m.created_at DESC LIMIT 1`);
    const { rows: dup } = await db.execute(sql`SELECT 1 FROM whatsapp_messages WHERE admin_id = ${adminId} AND direction = 'in' AND provider_id = ${p.id || ""} LIMIT 1`);
    if (p.id && dup.length) return { ok: true, duplicate: true };
    await db.insert(schema.whatsappMessages).values({
      adminId, direction: "in", phone, memberId: m?.id || null, event: "inbound", body: text,
      mediaUrl: String(inner.url || ""), mediaType: ["image", "file", "audio", "video", "sticker"].includes(p.type) ? p.type : "",
      status: "received", providerId: p.id || null, data: { name: p.sender?.name || "", type: p.type || "text", context: p.context || undefined },
    });
    return { ok: true, saved: true };
  }
  return { ok: true, ignored: body?.type || "empty" };
}

/* ── inbox + log ──────────────────────────────────────────────────────── */

/** Conversations: last message per phone, unread count, member name. */
export async function inbox(adminId, { q = "", page = 1 } = {}) {
  const size = 40;
  const like = q ? `%${String(q).trim().toLowerCase()}%` : null;
  const { rows } = await db.execute(sql`
    WITH last AS (
      SELECT DISTINCT ON (phone) phone, body, direction, status, created_at, member_id
      FROM whatsapp_messages WHERE admin_id = ${adminId} ORDER BY phone, created_at DESC
    ), stats AS (
      SELECT phone, count(*) FILTER (WHERE direction = 'in' AND read_at IS NULL)::int AS unread,
             max(created_at) FILTER (WHERE direction = 'in') AS last_in,
             (array_agg(member_id ORDER BY created_at DESC) FILTER (WHERE member_id IS NOT NULL))[1] AS member_id,
             (array_agg(data->>'name' ORDER BY created_at DESC) FILTER (WHERE direction = 'in'))[1] AS wa_name
      FROM whatsapp_messages WHERE admin_id = ${adminId} GROUP BY phone
    )
    SELECT l.phone, l.body, l.direction, l.status, l.created_at, s.unread, s.last_in, s.wa_name,
           m.id AS member_id, m.display_name, m.registration_number, m.village
    FROM last l JOIN stats s USING (phone) LEFT JOIN members m ON m.id = s.member_id
    ${like ? sql`WHERE lower(coalesce(m.display_name, '') || ' ' || coalesce(m.registration_number, '') || ' ' || l.phone || ' ' || coalesce(s.wa_name, '')) LIKE ${like}` : sql``}
    ORDER BY (s.unread > 0) DESC, l.created_at DESC
    LIMIT ${size} OFFSET ${(Math.max(1, page) - 1) * size}`);
  const { rows: [u] } = await db.execute(sql`SELECT count(*)::int AS n FROM whatsapp_messages WHERE admin_id = ${adminId} AND direction = 'in' AND read_at IS NULL`);
  return {
    unread: u.n,
    chats: rows.map((r) => ({
      phone: r.phone, last: r.body, direction: r.direction, status: r.status, at: iso(r.created_at), unread: r.unread,
      canReply: !!r.last_in && Date.now() - new Date(r.last_in).getTime() < 24 * 3600e3,
      memberId: r.member_id, name: r.display_name || r.wa_name || "", regNo: r.registration_number || "", village: r.village || "",
    })),
  };
}

export async function thread(adminId, phone) {
  const to = waPhone(phone);
  if (!to) throw badRequest("Number galat hai");
  const { rows } = await db.execute(sql`
    SELECT id, direction, event, body, media_url, media_type, status, error, created_at, data
    FROM whatsapp_messages WHERE admin_id = ${adminId} AND phone = ${to} ORDER BY created_at DESC LIMIT 200`);
  await db.execute(sql`UPDATE whatsapp_messages SET read_at = now() WHERE admin_id = ${adminId} AND phone = ${to} AND direction = 'in' AND read_at IS NULL`);
  const lastIn = rows.find((r) => r.direction === "in");
  return {
    phone: to,
    canReply: !!lastIn && Date.now() - new Date(lastIn.created_at).getTime() < 24 * 3600e3,
    messages: rows.reverse().map((r) => ({
      id: r.id, direction: r.direction, event: r.event, body: r.body, mediaUrl: r.media_url, mediaType: r.media_type,
      status: r.status, error: r.error, at: iso(r.created_at), name: r.data?.name || "",
    })),
  };
}

/** Reply from the inbox: plain text, only within 24 h of the member's last message (WhatsApp rule). */
export async function reply(adminId, phone, text, by = "") {
  const s = await getWhatsapp(adminId);
  if (!ready(s)) throw badRequest("WhatsApp chalu nahi hai (Settings → WhatsApp)");
  const to = waPhone(phone);
  const body = String(text || "").trim().slice(0, 4000);
  if (!to || !body) throw badRequest("Message likhein");
  const { rows: [l] } = await db.execute(sql`SELECT max(created_at) AS t FROM whatsapp_messages WHERE admin_id = ${adminId} AND phone = ${to} AND direction = 'in'`);
  if (!l?.t || Date.now() - new Date(l.t).getTime() > 24 * 3600e3) {
    throw badRequest("24 ghante se member ka koi message nahi aaya — WhatsApp ke niyam se ab sirf template message bhej sakte hain");
  }
  const r = await sendText(s, { to, text: body });
  const { rows: [m] } = await db.execute(sql`SELECT member_id FROM whatsapp_messages WHERE admin_id = ${adminId} AND phone = ${to} AND member_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`);
  const [row] = await db.insert(schema.whatsappMessages).values({
    adminId, phone: to, memberId: m?.member_id || null, event: "reply", body,
    status: r.ok ? "submitted" : "failed", providerId: r.messageId || null, error: r.ok ? "" : r.error, data: { by },
  }).returning();
  if (!r.ok) throw badRequest(r.error);
  return { id: row.id };
}

/** Sent-messages log with counts per status. */
export async function messageLog(adminId, { event, status, page = 1 } = {}) {
  const size = 50;
  const where = sql`w.admin_id = ${adminId} AND w.direction = 'out' ${event ? sql`AND w.event = ${event}` : sql``} ${status ? sql`AND w.status = ${status}` : sql``}`;
  const { rows } = await db.execute(sql`
    SELECT w.id, w.phone, w.event, w.status, w.error, w.body, w.media_url, w.created_at, w.updated_at,
           m.display_name, m.registration_number
    FROM whatsapp_messages w LEFT JOIN members m ON m.id = w.member_id
    WHERE ${where} ORDER BY w.created_at DESC LIMIT ${size} OFFSET ${(Math.max(1, page) - 1) * size}`);
  const { rows: [c] } = await db.execute(sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status IN ('submitted', 'enqueued', 'queued'))::int AS waiting,
      count(*) FILTER (WHERE status = 'sent')::int AS sent,
      count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
      count(*) FILTER (WHERE status = 'read')::int AS read,
      count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM whatsapp_messages WHERE admin_id = ${adminId} AND direction = 'out' ${event ? sql`AND event = ${event}` : sql``}`);
  return {
    counts: c, page, pageSize: size,
    messages: rows.map((r) => ({
      id: r.id, phone: r.phone, event: r.event, status: r.status, error: r.error, body: r.body, mediaUrl: r.media_url,
      at: iso(r.created_at), updatedAt: iso(r.updated_at), name: r.display_name || "", regNo: r.registration_number || "",
    })),
  };
}
