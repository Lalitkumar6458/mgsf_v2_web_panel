// Notifications: saved in Postgres (the app's "सूचनाएँ" inbox) + sent as Expo push.
// No Firebase on the server: we only call Expo's free push service (exp.host). Expo hands the
// message to Google (Android) / Apple (iOS). EXPO_ACCESS_TOKEN in .env is optional (only needed
// when "enhanced push security" is switched on for the Expo project).
//
//   notify(adminId, accountIds, { title, body, data })      one message to many logins
//   deliver(adminId, [{ accountId, title, body, data }])   a different message per login
//   notifyMembers(adminId, [{ memberId, title, body, data }])  member → his login + same-mobile family logins
//   notifyAgent(adminId, agentId, msg)
//
// Several messages for one phone in one go (a family: closing dues for 3 members) are merged into
// one push. Phones that uninstalled the app (Expo: DeviceNotRegistered) lose their token.
import { sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

const EXPO_URL = "https://exp.host/--/api/v2/push/send";
const CHANNEL = "marriage-custom-channel"; // the app creates this Android channel (same as the old app)

const inList = (ids) => sql.join(ids.map((x) => sql`${x}`), sql`, `);
const clip = (s, n) => String(s ?? "").slice(0, n);

/** Expo push token (old app: "ExponentPushToken[…]", new: "ExpoPushToken[…]") */
export const isExpoToken = (t) => /^Expo(nent)?PushToken\[.+\]$/.test(String(t || ""));

/**
 * Save one inbox row per message and push to every login that has a phone token.
 * items: [{ accountId, title, body?, data? }]  →  { saved, devices, pushed, failed }
 */
export async function deliver(adminId, items) {
  const list = items.filter((x) => x.accountId && x.title);
  if (!list.length) return { saved: 0, devices: 0, pushed: 0, failed: 0 };
  for (let i = 0; i < list.length; i += 500) {
    await db.insert(schema.notifications).values(list.slice(i, i + 500).map((x) => ({
      adminId, accountId: x.accountId, title: clip(x.title, 200), body: clip(x.body, 2000), data: x.data || {},
    })));
  }

  const ids = [...new Set(list.map((x) => x.accountId))];
  const tokens = await phoneTokens(ids); // accountId → Set(token) — every phone the login is on

  // one push per phone: messages for the same token are merged
  const byToken = new Map();
  for (const x of list) {
    for (const to of tokens.get(x.accountId) || []) {
      if (!byToken.has(to)) byToken.set(to, []);
      byToken.get(to).push(x);
    }
  }
  const messages = [...byToken.entries()].map(([to, xs]) => {
    const one = xs.length === 1;
    return {
      to,
      title: clip(one ? xs[0].title : `${xs[0].title} (${xs.length})`, 120),
      body: clip(one ? xs[0].body : xs.map((x) => x.body || x.title).join("\n"), 1500),
      data: one ? xs[0].data || {} : { ...(xs[0].data || {}), many: xs.length },
      sound: "default",
      priority: "high",
      channelId: CHANNEL,
    };
  });

  let pushed = 0, failed = 0;
  const dead = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "gzip, deflate",
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(j.data)) { failed += chunk.length; console.error("[push]", res.status, JSON.stringify(j).slice(0, 300)); continue; }
      j.data.forEach((t, k) => {
        if (t.status === "ok") pushed++;
        else {
          failed++;
          if (t.details?.error === "DeviceNotRegistered") dead.push(chunk[k].to);
        }
      });
    } catch (e) {
      failed += chunk.length;
      console.error("[push]", e.message);
    }
  }
  if (dead.length) {
    await db.execute(sql`UPDATE accounts SET push_token = NULL WHERE push_token IN (${inList(dead)})`).catch(() => {});
    await db.execute(sql`UPDATE sessions SET push_token = NULL WHERE push_token IN (${inList(dead)})`).catch(() => {});
  }
  return { saved: list.length, devices: messages.length, pushed, failed };
}

/**
 * Push tokens per login: one per logged-in phone (sessions.push_token, not logged out, seen in the
 * last 45 days). A login without any — an older app build — falls back to accounts.push_token.
 */
export async function phoneTokens(accountIds) {
  const out = new Map();
  for (let i = 0; i < accountIds.length; i += 1000) {
    const chunk = inList(accountIds.slice(i, i + 1000));
    const { rows: ss } = await db.execute(sql`
      SELECT s.account_id, s.push_token FROM sessions s JOIN accounts a ON a.id = s.account_id AND a.active
      WHERE s.account_id IN (${chunk}) AND s.revoked_at IS NULL AND s.push_token IS NOT NULL
        AND s.last_seen_at > now() - interval '45 days'`);
    for (const r of ss) {
      if (!isExpoToken(r.push_token)) continue;
      if (!out.has(r.account_id)) out.set(r.account_id, new Set());
      out.get(r.account_id).add(r.push_token);
    }
    const { rows: as } = await db.execute(sql`SELECT id, push_token FROM accounts WHERE id IN (${chunk}) AND active AND push_token IS NOT NULL`);
    for (const r of as) if (!out.has(r.id) && isExpoToken(r.push_token)) out.set(r.id, new Set([r.push_token]));
  }
  return out;
}

/** The same message to many logins. */
export function notify(adminId, accountIds, { title, body = "", data = {} }) {
  return deliver(adminId, accountIds.map((accountId) => ({ accountId, title, body, data })));
}

/** Notify an agent's login (e.g. "new member added"). */
export async function notifyAgent(adminId, agentId, msg) {
  const { rows } = await db.execute(sql`SELECT id FROM accounts WHERE agent_id = ${agentId} AND active`);
  return notify(adminId, rows.map((r) => r.id), msg);
}

/**
 * Messages about members → the member's own login and the logins of his family (same mobile number,
 * same trust) — the family sees each other in the app, and often only one of them is logged in.
 * items: [{ memberId, title, body, data }]
 */
export async function notifyMembers(adminId, items) {
  const mids = [...new Set(items.map((x) => x.memberId).filter(Boolean))];
  if (!mids.length) return { saved: 0, devices: 0, pushed: 0, failed: 0 };
  const reach = new Map(); // memberId → [accountId]
  for (let i = 0; i < mids.length; i += 1000) {
    const { rows } = await db.execute(sql`
      WITH t AS (
        SELECT m.id, right(regexp_replace(coalesce(m.phone, ''), '\\D', '', 'g'), 10) AS ph
        FROM members m WHERE m.id IN (${inList(mids.slice(i, i + 1000))})
      )
      SELECT DISTINCT t.id AS member_id, a.id AS account_id
      FROM t
      JOIN members f ON f.id = t.id OR (length(t.ph) = 10 AND NOT f.deleted AND f.status IN ('accepted', 'closed') AND (
             right(regexp_replace(coalesce(f.phone, ''), '\\D', '', 'g'), 10) = t.ph OR
             right(regexp_replace(coalesce(f.phone_alt, ''), '\\D', '', 'g'), 10) = t.ph))
      JOIN programs p ON p.id = f.program_id AND p.admin_id = ${adminId}
      JOIN accounts a ON a.member_id = f.id AND a.active AND a.role = 'member'`);
    for (const r of rows) {
      if (!reach.has(r.member_id)) reach.set(r.member_id, []);
      reach.get(r.member_id).push(r.account_id);
    }
  }
  const out = [];
  for (const x of items) for (const accountId of reach.get(x.memberId) || []) out.push({ accountId, title: x.title, body: x.body, data: { memberId: x.memberId, ...(x.data || {}) } });
  return deliver(adminId, out);
}

/** Fire and forget — never let a push problem fail or slow the request that caused it. */
export function later(fn) {
  setTimeout(() => { Promise.resolve().then(fn).catch((e) => console.error("[push]", e?.message || e)); }, 0);
}
